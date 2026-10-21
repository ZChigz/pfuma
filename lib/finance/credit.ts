// Credit on a learner's account: money a verified payment holds beyond what it has settled. It is used at the next billing (a setting), moved to a
// brother or sister on the same fee payer, or refunded. The balance is always worked out from the payments, transfers and refunds, never stored;
// the ledger below lists them as rows (+ overpayments and credit received, − credit used, moved or refunded).
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { amountSchema, audit, dayOf, idSchema, need, nextSerial, tellApprovers, todayInHarare, whySchema, ymd, type Actor } from '@/lib/finance/common';
import { paymentCredits } from '@/lib/finance/balances';
import { formatMoney, zeroTotals, type Cur, type Totals } from '@/lib/finance/money';
import { randomBytes } from 'node:crypto';

export interface CreditEntry { at: string; kind: 'OVERPAYMENT' | 'RECEIVED' | 'MOVED_OUT' | 'REFUNDED' | 'USED'; description: string; currency: Cur; cents: number }

/** A learner's credit: the total per currency, the payments holding it, and the movements. */
export async function creditLedger(user: Actor, studentId: string) {
  need(user, 'finance.statements.view', 'finance.accounts.view', 'finance.credit.transfer', 'finance.payments.record');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (!(await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Student not found', 404);
    const credits = await paymentCredits(tx, user.schoolId, { studentIds: [studentId] });
    const total: Totals = zeroTotals();
    for (const c of credits) total[c.currency] += c.creditCents;
    const [payments, refunds, outs] = await Promise.all([
      tx.finPayment.findMany({ where: { schoolId: user.schoolId, studentId, status: 'VERIFIED', voidRow: null }, include: { allocations: { select: { amountCents: true } } }, orderBy: { receivedOn: 'asc' } }),
      tx.finRefund.findMany({ where: { schoolId: user.schoolId, payment: { studentId }, chargeId: null, status: 'PAID' }, include: { payment: { select: { currency: true, receiptNumber: true } } } }),
      tx.creditTransfer.findMany({ where: { schoolId: user.schoolId, fromStudentId: studentId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const entries: CreditEntry[] = [];
    for (const p of payments) {
      const settled = p.allocations.reduce((s, a) => s + a.amountCents, 0);
      if (p.method === 'CREDIT_TRANSFER') entries.push({ at: p.receivedOn.toISOString(), kind: 'RECEIVED', description: `Credit received from a brother or sister (${p.receiptNumber ?? p.ackNumber})`, currency: p.currency, cents: p.amountCents });
      else if (p.amountCents > settled) entries.push({ at: p.receivedOn.toISOString(), kind: 'OVERPAYMENT', description: `Paid more than was owed (${p.receiptNumber ?? p.ackNumber})`, currency: p.currency, cents: p.amountCents - settled });
    }
    for (const r of refunds) entries.push({ at: (r.paidAt ?? r.requestedAt).toISOString(), kind: 'REFUNDED', description: `Refunded (${r.payment.receiptNumber ?? ''})`, currency: r.payment.currency, cents: -r.amountCents });
    for (const t of outs) entries.push({ at: t.createdAt.toISOString(), kind: 'MOVED_OUT', description: `Moved to a brother or sister: ${t.reason}`, currency: t.currency, cents: -t.amountCents });
    entries.sort((a, b) => a.at.localeCompare(b.at));
    return {
      total,
      holding: credits.map((c) => ({ paymentId: c.paymentId, receipt: c.receiptNumber ?? c.ackNumber, currency: c.currency, creditCents: c.creditCents, fundId: c.fundId })),
      entries,
    };
  });
}

export const TransferSchema = z.object({ fromStudentId: idSchema, toStudentId: idSchema, currency: z.enum(['USD', 'ZIG']), amount: amountSchema, reason: whySchema(5) });

/**
 * Moves credit to a brother or sister (same fee payer). The credit leaves the source payments at once and arrives on the other learner's account
 * as a payment of method "credit moved" that someone else verifies; if it is rejected, the credit is back where it was.
 */
export async function transferCredit(user: Actor, raw: unknown) {
  need(user, 'finance.credit.transfer');
  const input = TransferSchema.parse(raw);
  if (input.fromStudentId === input.toStudentId) throw new ServiceError('Choose a different learner to receive the credit', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [from, to] = await Promise.all([
      tx.student.findFirst({ where: { id: input.fromStudentId, schoolId: user.schoolId }, select: { id: true, fullName: true } }),
      tx.student.findFirst({ where: { id: input.toStudentId, schoolId: user.schoolId }, select: { id: true, fullName: true } }),
    ]);
    if (!from || !to) throw new ServiceError('Student not found', 404);
    const shared = await tx.studentGuardian.findFirst({ where: { studentId: from.id, OR: [{ isFeePayer: true }, { isPrimary: true }], guardian: { students: { some: { studentId: to.id } } } }, select: { guardianId: true } });
    if (!shared) throw new ServiceError('Credit can only be moved between learners with the same fee payer', 422);
    const credits = (await paymentCredits(tx, user.schoolId, { studentIds: [from.id], currency: input.currency }));
    const have = credits.reduce((s, c) => s + c.creditCents, 0);
    if (input.amount > have) throw new ServiceError(`${from.fullName} holds only ${formatMoney(have, input.currency as Cur)} of credit`, 409);
    let left = input.amount;
    const year = Number(todayInHarare().slice(0, 4));
    const moved: { fromPaymentId: string; toPaymentId: string; cents: number }[] = [];
    for (const c of credits) {
      if (left <= 0) break;
      const take = Math.min(left, c.creditCents);
      const ack = await nextSerial(tx, user.schoolId, year, 'ACK');
      const synthetic = await tx.finPayment.create({
        data: {
          schoolId: user.schoolId, studentId: to.id, fundId: c.fundId, ackNumber: ack, verifyCode: randomBytes(5).toString('hex').toUpperCase(), currency: input.currency, amountCents: take, method: 'CREDIT_TRANSFER',
          receivedOn: dayOf(todayInHarare()), note: `Credit moved from ${from.fullName} (${c.receiptNumber ?? c.ackNumber}): ${input.reason}`, status: 'PENDING', recordedById: user.id,
        },
      });
      await tx.creditTransfer.create({ data: { schoolId: user.schoolId, fromStudentId: from.id, toStudentId: to.id, fromPaymentId: c.paymentId, toPaymentId: synthetic.id, currency: input.currency, amountCents: take, reason: input.reason, createdById: user.id } });
      moved.push({ fromPaymentId: c.paymentId, toPaymentId: synthetic.id, cents: take });
      left -= take;
    }
    await audit(tx, user, 'TRANSFER_CREDIT', 'Student', from.id, `Moved ${formatMoney(input.amount, input.currency as Cur)} of credit from ${from.fullName} to ${to.fullName}: ${input.reason}`, undefined, {
      fromStudentId: from.id, toStudentId: to.id, currency: input.currency, amountCents: input.amount, payments: moved, date: ymd(new Date()),
    });
    await tellApprovers(tx, user, 'finance.payments.verify', { title: 'Credit moved to a brother or sister: verify', body: `${from.fullName} to ${to.fullName}`, link: '/finance/payments?status=PENDING' });
    return { moved };
  });
}
