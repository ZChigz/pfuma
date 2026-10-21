// Refunds. Money handed back to a payer: asked for by one person, approved by a second, paid out by a third.
// With a charge it reverses what the payment had settled (the student owes it again once it is paid out); without one it
// returns credit that was never allocated. The database refuses a refund larger than the payment settled or holds.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { amountSchema, audit, idSchema, nameMap, nameOf, need, tellApprovers, whySchema, type Actor } from '@/lib/finance/common';
import { notifyUsers } from '@/lib/system/notifications';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { paymentCredits } from '@/lib/finance/balances';
import type { Method } from '@/lib/finance/payments';

const METHODS = ['CASH', 'ECOCASH', 'ONEMONEY', 'INNBUCKS', 'SWIPE', 'BANK_TRANSFER', 'ZIPIT', 'BANK_DEPOSIT', 'CHEQUE'] as const;
export const REFUND_REASONS = ['LEFT_SCHOOL', 'OVERPAID', 'CANCELLED_ADMISSION', 'OTHER'] as const;
export const REFUND_REASON_LABEL: Record<(typeof REFUND_REASONS)[number], string> = { LEFT_SCHOOL: 'Left the school', OVERPAID: 'Overpaid', CANCELLED_ADMISSION: 'Cancelled admission', OTHER: 'Other' };
// A refund names the payment it comes from; or, to return a learner's credit, the learner and currency (the payment holding enough credit is found).
export const RefundSchema = z.object({
  paymentId: idSchema.optional(), studentId: idSchema.optional(), currency: z.enum(['USD', 'ZIG']).optional(), chargeId: idSchema.nullable().optional(),
  amount: amountSchema, reason: whySchema(5), reasonKind: z.enum(REFUND_REASONS).default('OTHER'), method: z.enum(METHODS).optional(),
}).refine((v) => v.paymentId || (v.studentId && v.currency), { message: 'Choose the payment, or the learner and the currency', path: ['paymentId'] });
export const PayRefundSchema = z.object({ method: z.enum(METHODS), reference: z.string().trim().max(80).optional().transform((v) => v || undefined) });

export async function requestRefund(user: Actor, raw: unknown) {
  need(user, 'finance.refunds.request');
  const input = RefundSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    let paymentId = input.paymentId;
    if (!paymentId) {
      // Returning credit: the payment of this learner and currency that still holds enough of it.
      const credits = (await paymentCredits(tx, user.schoolId, { studentIds: [input.studentId!], currency: input.currency })).filter((c) => c.creditCents >= input.amount);
      if (credits.length === 0) throw new ServiceError('No single payment of this learner holds that much credit. Refund it in parts.', 409);
      paymentId = credits[0]!.paymentId;
    }
    const p = await tx.finPayment.findFirst({ where: { id: paymentId, schoolId: user.schoolId }, include: { voidRow: true, student: { select: { fullName: true } } } });
    if (!p) throw new ServiceError('Payment not found', 404);
    if (p.status !== 'VERIFIED' || p.voidRow) throw new ServiceError('Only a verified payment that has not been voided can be refunded', 409);
    if (input.chargeId) {
      const c = await tx.finCharge.findFirst({ where: { id: input.chargeId, schoolId: user.schoolId } });
      const family = c && c.studentId !== p.studentId && p.guardianId ? await tx.studentGuardian.count({ where: { guardianId: p.guardianId, studentId: c.studentId } }) : 0;
      if (!c || (c.studentId !== p.studentId && !family)) throw new ServiceError('Charge not found', 404);
      const [alloc, other] = await Promise.all([
        tx.finPaymentAllocation.aggregate({ where: { schoolId: user.schoolId, paymentId: p.id, chargeId: input.chargeId }, _sum: { amountCents: true } }),
        tx.finRefund.aggregate({ where: { schoolId: user.schoolId, paymentId: p.id, chargeId: input.chargeId, status: { not: 'REJECTED' } }, _sum: { amountCents: true } }),
      ]);
      const room = (alloc._sum.amountCents ?? 0) - (other._sum.amountCents ?? 0);
      if (input.amount > room) throw new ServiceError(`Only ${formatMoney(room, p.currency)} of this payment can still be refunded against this charge`, 409);
    } else {
      const credit = (await paymentCredits(tx, user.schoolId, { studentIds: [p.studentId] })).find((c) => c.paymentId === p.id)?.creditCents ?? 0;
      if (input.amount > credit) throw new ServiceError(`Only ${formatMoney(credit, p.currency)} of this payment is unallocated credit that can be returned`, 409);
    }
    const r = await tx.finRefund.create({
      data: { schoolId: user.schoolId, paymentId: p.id, chargeId: input.chargeId ?? null, amountCents: input.amount, reason: input.reason, reasonKind: input.reasonKind, method: input.method ?? null, requestedById: user.id },
    });
    await audit(tx, user, 'REQUEST_REFUND', 'FinRefund', r.id, `Asked for a refund of ${input.amount} cents on receipt ${p.receiptNumber} for ${p.student.fullName}`, undefined, {
      paymentId: p.id, chargeId: input.chargeId ?? null, amountCents: input.amount, currency: p.currency, reason: input.reason, status: 'REQUESTED',
    });
    await tellApprovers(tx, user, 'finance.refunds.approve', { title: 'Refund to approve', body: `${p.student.fullName}, receipt ${p.receiptNumber}`, link: '/finance/refunds' });
    return { id: r.id };
  });
}

export async function decideRefund(user: Actor, id: string, decision: 'approve' | 'reject', rawReason?: unknown) {
  need(user, 'finance.refunds.approve');
  const reason = rawReason === undefined || rawReason === '' ? undefined : whySchema(3).parse(rawReason);
  if (decision === 'reject' && !reason) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.finRefund.findFirst({ where: { id, schoolId: user.schoolId }, include: { payment: { select: { receiptNumber: true, student: { select: { fullName: true } } } } } });
    if (!r) throw new ServiceError('Refund not found', 404);
    if (r.status !== 'REQUESTED') throw new ServiceError(`This refund was already ${r.status.toLowerCase()}`, 409);
    if (r.requestedById === user.id) throw new ServiceError('You asked for this refund, so someone else must decide on it.', 403);
    const data = decision === 'approve'
      ? { status: 'APPROVED' as const, approvedById: user.id, approvedAt: new Date() }
      : { status: 'REJECTED' as const, rejectedById: user.id, rejectedAt: new Date(), rejectionReason: reason };
    const moved = await tx.finRefund.updateMany({ where: { id, schoolId: user.schoolId, status: 'REQUESTED' }, data });
    if (moved.count !== 1) throw new ServiceError('This refund was just decided by someone else', 409);
    await audit(tx, user, decision === 'approve' ? 'APPROVE_REFUND' : 'REJECT_REFUND', 'FinRefund', id,
      `${decision === 'approve' ? 'Approved' : 'Rejected'} the refund on receipt ${r.payment.receiptNumber} for ${r.payment.student.fullName}`,
      { status: 'REQUESTED' }, { status: data.status, decidedById: user.id, amountCents: r.amountCents, reason: reason ?? null });
    if (decision === 'approve') await tellApprovers(tx, user, 'finance.refunds.pay', { title: 'Refund to pay out', body: `${r.payment.student.fullName}, receipt ${r.payment.receiptNumber}`, link: '/finance/refunds' });
    await notifyUsers(tx, user.schoolId, [r.requestedById], { type: 'FINANCE', title: `Refund ${data.status.toLowerCase()}`, body: `${r.payment.student.fullName}, receipt ${r.payment.receiptNumber}`, link: '/finance/refunds' });
    return { id, status: data.status };
  });
}

/** The money leaves: by someone who neither asked for the refund nor approved it. Only now does the student's balance move. */
export async function payRefund(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.refunds.pay');
  const input = PayRefundSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.finRefund.findFirst({ where: { id, schoolId: user.schoolId }, include: { payment: { select: { receiptNumber: true, voidRow: true, student: { select: { fullName: true } } } } } });
    if (!r) throw new ServiceError('Refund not found', 404);
    if (r.status !== 'APPROVED') throw new ServiceError(r.status === 'PAID' ? 'This refund was already paid out' : 'This refund has not been approved', 409);
    if (r.requestedById === user.id) throw new ServiceError('You asked for this refund, so someone else must pay it out.', 403);
    if (r.approvedById === user.id) throw new ServiceError('You approved this refund, so someone else must pay it out.', 403);
    if (r.payment.voidRow) throw new ServiceError('The payment was voided, so the refund cannot be paid', 409);
    const moved = await tx.finRefund.updateMany({ where: { id, schoolId: user.schoolId, status: 'APPROVED' }, data: { status: 'PAID', paidById: user.id, paidAt: new Date(), method: input.method, reference: input.reference } });
    if (moved.count !== 1) throw new ServiceError('This refund was just paid by someone else', 409);
    await audit(tx, user, 'PAY_REFUND', 'FinRefund', id, `Paid the refund on receipt ${r.payment.receiptNumber} to ${r.payment.student.fullName}`,
      { status: 'APPROVED' }, { status: 'PAID', paidById: user.id, method: input.method, reference: input.reference ?? null, amountCents: r.amountCents });
    return { id };
  });
}

export interface RefundRow {
  id: string;
  paymentId: string;
  receiptNumber: string | null;
  studentId: string;
  studentName: string;
  charge: string | null;
  currency: Cur;
  fundName: string;
  amountCents: number;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
  requestedBy: string | null;
  requestedById: string;
  approvedBy: string | null;
  approvedById: string | null;
  paidBy: string | null;
  method: Method | null;
  reference: string | null;
  requestedAt: string;
  rejectionReason: string | null;
}

export async function listRefunds(user: Actor, f: { status?: RefundRow['status']; page?: number; pageSize?: number } = {}) {
  need(user, 'finance.refunds.request', 'finance.refunds.approve', 'finance.refunds.pay', 'finance.payments.view');
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.FinRefundWhereInput = { schoolId: user.schoolId, ...(f.status ? { status: f.status } : {}) };
    const [total, rows] = await Promise.all([
      tx.finRefund.count({ where }),
      tx.finRefund.findMany({
        where, orderBy: { requestedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { charge: { select: { description: true } }, payment: { select: { receiptNumber: true, currency: true, studentId: true, student: { select: { fullName: true } }, fund: { select: { name: true } } } } },
      }),
    ]);
    const names = await nameMap(tx, user.schoolId, rows.flatMap((r) => [r.requestedById, r.approvedById, r.paidById]));
    const out: RefundRow[] = rows.map((r) => ({
      id: r.id, paymentId: r.paymentId, receiptNumber: r.payment.receiptNumber, studentId: r.payment.studentId, studentName: r.payment.student.fullName, charge: r.charge?.description ?? null,
      currency: r.payment.currency, fundName: r.payment.fund?.name ?? 'Any fund', amountCents: r.amountCents, reason: r.reason, status: r.status, requestedBy: nameOf(names, r.requestedById), requestedById: r.requestedById,
      approvedBy: nameOf(names, r.approvedById), approvedById: r.approvedById, paidBy: nameOf(names, r.paidById), method: (r.method as Method | null) ?? null, reference: r.reference,
      requestedAt: r.requestedAt.toISOString(), rejectionReason: r.rejectionReason,
    }));
    return { rows: out, total, page, pageSize };
  });
}
