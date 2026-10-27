// Payments. Recording money and verifying it are two different people's jobs. Cash is received at once (official receipt number on the
// spot) and the bursar confirms it at the daily cash-up; mobile money, bank and the rest wait as pending with an acknowledgement slip and get
// their official receipt number when someone else verifies them. Verified money is allocated to unpaid charges in the school's order;
// what is left stays as credit. Nothing is edited or deleted: a wrong payment is rejected before verification, or voided by the Owner after.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { grantsFor } from '@/lib/access/effective';
import { scopeWhere } from '@/lib/access/where';
import { effectiveOf } from '@/lib/access/user';
import { rateFor } from '@/lib/exchange-rate';
import {
  activeFund, amountSchema, assertCurrencyOn, audit, currencySchema, dayOf, holds, idSchema, isoDateSchema, loadFinSettings, nameMap, nameOf, need, nextReceiptNumber, nextSerial,
  tellApprovers, todayInHarare, whySchema, ymd, type Actor,
} from '@/lib/finance/common';
import { chargeLines, paymentCredits, type ChargeLine, type CreditLine } from '@/lib/finance/balances';
import { allocateOldestFirst, allocateProportional, formatMoney, type Cur } from '@/lib/finance/money';
import { CLERK_METHODS, METHODS, METHOD_LABEL, PROOF_METHODS, isCash, needsReference, type Method } from '@/lib/finance/methods';
import { feePayerContacts, queueSms } from '@/lib/finance/sms';

export { METHOD_LABEL };
export type { Method };

const ALL_METHODS = [...METHODS, 'CREDIT_TRANSFER'] as const;
const WAITING = ['PENDING', 'RECEIVED'] as const;
const newVerifyCode = () => randomBytes(5).toString('hex').toUpperCase();

export const RecordPaymentSchema = z.object({
  // The learner; or, for a family payment, the fee-payer guardian (and optionally one of their children to hold the receipt).
  studentId: idSchema.optional(),
  guardianId: idSchema.optional(),
  currency: currencySchema,
  method: z.enum(ALL_METHODS),
  reference: z.string().trim().max(80).optional().transform((v) => v || undefined),
  paidBy: z.string().trim().max(80).optional().transform((v) => v || undefined),
  receivedOn: isoDateSchema.optional(),
  backdateReason: z.string().trim().max(200).optional(),
  note: z.string().trim().max(300).optional().transform((v) => v || undefined),
  proofKey: z.string().trim().max(200).optional().transform((v) => v || undefined),
  chargeId: idSchema.optional(),
  // A USD charge paid in ZiG: the ZiG received. The USD value settled is worked out at the rate in force on the payment date.
  zigAmount: amountSchema.optional(),
  // One receipt per line. A line with no fund is shared over the charges in the school's order; with a fund it settles that fund only.
  lines: z.array(z.object({ fundId: idSchema.nullable().optional(), amount: amountSchema.optional() })).min(1, 'Add an amount').max(6),
}).superRefine((v, ctx) => {
  if (!v.studentId && !v.guardianId) ctx.addIssue({ code: 'custom', message: 'Choose who is paying: a learner or a family', path: ['studentId'] });
  if (v.zigAmount !== undefined) {
    if (v.currency !== 'USD') ctx.addIssue({ code: 'custom', message: 'Only a US dollar charge can be paid in ZiG at a rate', path: ['zigAmount'] });
    if (v.lines.length !== 1) ctx.addIssue({ code: 'custom', message: 'A payment in ZiG has a single line', path: ['lines'] });
  } else if (v.lines.some((l) => l.amount === undefined)) ctx.addIssue({ code: 'custom', message: 'Enter the amount', path: ['lines'] });
});

// ─── Allocation ──────────────────────────────────────────────────────────────

export interface Allocated { paymentId: string; chargeId: string; amountCents: number }

/** The children of the fee-payer guardians of a learner (and the learner), who share family payments and credit. */
async function familyOf(tx: Db, schoolId: string, studentId: string): Promise<string[]> {
  const mine = await tx.studentGuardian.findMany({ where: { studentId, student: { schoolId }, OR: [{ isFeePayer: true }, { isPrimary: true }] }, select: { guardianId: true } });
  if (mine.length === 0) return [studentId];
  const kids = await tx.studentGuardian.findMany({ where: { guardianId: { in: mine.map((m) => m.guardianId) }, student: { schoolId, status: 'ACTIVE' } }, select: { studentId: true } });
  return Array.from(new Set([studentId, ...kids.map((k) => k.studentId)]));
}

async function childrenOf(tx: Db, schoolId: string, guardianId: string): Promise<string[]> {
  const kids = await tx.studentGuardian.findMany({ where: { guardianId, student: { schoolId } }, select: { studentId: true } });
  return kids.map((k) => k.studentId);
}

/**
 * Settles unpaid charges with the credit verified payments hold. Order is the school's choice: oldest term first and then by fund order,
 * or shared in proportion over everything owed. What the payer said the money is for is settled first. A payment for one fund settles that
 * fund only; a family payment may settle any of the fee payer's children. Runs inside the caller's transaction; the caller audits.
 */
export async function applyCreditTx(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, studentId: string, only?: { paymentId?: string }): Promise<Allocated[]> {
  const family = await familyOf(tx, user.schoolId, studentId);
  const credits = (await paymentCredits(tx, user.schoolId, { studentIds: family })).filter((c) => (c.studentId === studentId || c.guardianId !== null) && (!only?.paymentId || c.paymentId === only.paymentId));
  if (credits.length === 0) return [];
  const [settings, funds] = await Promise.all([loadFinSettings(tx, user.schoolId), tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, sortOrder: true } })]);
  const fundOrder = new Map(funds.map((f) => [f.id, f.sortOrder]));
  const scopeLines = new Map<string, ChargeLine[]>();
  const left = new Map<string, number>();
  const out: Allocated[] = [];

  for (const credit of credits) {
    const scope = credit.guardianId ? await childrenOf(tx, user.schoolId, credit.guardianId) : [credit.studentId];
    const key = scope.slice().sort().join(',');
    if (!scopeLines.has(key)) {
      const ls = await chargeLines(tx, user.schoolId, { studentIds: scope });
      scopeLines.set(key, ls);
      for (const l of ls) if (!left.has(l.chargeId)) left.set(l.chargeId, l.outstanding);
    }
    const open = scopeLines.get(key)!.filter((l) => l.currency === credit.currency && (!credit.fundId || l.fundId === credit.fundId) && (left.get(l.chargeId) ?? 0) > 0);
    open.sort((a, b) => a.termStart.getTime() - b.termStart.getTime() || (fundOrder.get(a.fundId) ?? 0) - (fundOrder.get(b.fundId) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
    const owed = open.map((l) => ({ chargeId: l.chargeId, outstandingCents: left.get(l.chargeId) ?? 0 }));
    let available = credit.creditCents;
    const splits: { chargeId: string; amountCents: number }[] = [];
    // What the payer said the money is for goes first.
    const target = credit.targetChargeId ? owed.find((o) => o.chargeId === credit.targetChargeId) : undefined;
    if (target) {
      const take = Math.min(available, target.outstandingCents);
      if (take > 0) splits.push({ chargeId: target.chargeId, amountCents: take });
      available -= take;
    }
    const rest = owed.filter((o) => o.chargeId !== target?.chargeId);
    splits.push(...(settings.allocationMode === 'PROPORTIONAL' ? allocateProportional(available, rest).splits : allocateOldestFirst(available, rest).splits));
    for (const sp of splits) {
      left.set(sp.chargeId, (left.get(sp.chargeId) ?? 0) - sp.amountCents);
      out.push({ paymentId: credit.paymentId, chargeId: sp.chargeId, amountCents: sp.amountCents });
    }
  }
  if (out.length) {
    await tx.finPaymentAllocation.createMany({ data: out.map((a) => ({ schoolId: user.schoolId, paymentId: a.paymentId, chargeId: a.chargeId, amountCents: a.amountCents, createdById: user.id })) });
  }
  return out;
}

/** Applies any credit a learner (or family) holds to what is owed, if the school lets billing do it. */
export async function applyCreditIfAllowed(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, studentId: string): Promise<Allocated[]> {
  if (!(await loadFinSettings(tx, user.schoolId)).applyCreditAtBilling) return [];
  return applyCreditTx(tx, user, studentId);
}

// ─── Record ──────────────────────────────────────────────────────────────────

export async function recordPayment(user: Actor, raw: unknown) {
  need(user, 'finance.payments.record');
  const input = RecordPaymentSchema.parse(raw);
  const today = todayInHarare();
  const receivedOn = input.receivedOn ?? today;
  if (receivedOn > today) throw new ServiceError('The date received cannot be in the future', 422);
  if (receivedOn < today && (input.backdateReason ?? '').trim().length < 5) throw new ServiceError('A payment dated before today needs a reason', 422);
  if (input.method === 'PAYNOW' || input.method === 'CREDIT_TRANSFER') throw new ServiceError('Paynow payments come in by themselves, and credit is moved from the learner’s account', 422);
  const fundIds = input.lines.map((l) => l.fundId ?? null);
  if (new Set(fundIds).size !== fundIds.length) throw new ServiceError('Each fund can appear only once', 422);
  if (input.proofKey && !proofKeyBelongsTo(input.proofKey, user.schoolId)) throw new ServiceError('That proof of payment does not belong to this school', 422);

  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    // Who is paying: a learner, or a family through its fee-payer guardian.
    let studentId = input.studentId;
    let guardianId: string | null = null;
    if (input.guardianId) {
      const kids = await childrenOf(tx, user.schoolId, input.guardianId);
      if (kids.length === 0) throw new ServiceError('Guardian not found', 404);
      if (studentId && !kids.includes(studentId)) throw new ServiceError('That learner is not a child of this guardian', 422);
      studentId = studentId ?? kids[0]!;
      guardianId = input.guardianId;
    }
    const student = await tx.student.findFirst({ where: { id: studentId!, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    const settings = await loadFinSettings(tx, user.schoolId);
    if (needsReference(input.method) && settings.requireReference && !input.reference) {
      throw new ServiceError('Enter the reference (the transaction id or bank reference) for a payment that is not cash', 422);
    }

    // ZiG paid against a US dollar charge: the rate in force on the payment date, never a copied number.
    let zig: { zigCents: number; rateId: string; rate: number } | null = null;
    if (input.zigAmount !== undefined) {
      await assertCurrencyOn(tx, user.schoolId, 'ZIG');
      const row = await rateFor(tx, new Date(`${receivedOn}T23:59:59.999Z`));
      if (!row) throw new ServiceError(`There is no exchange rate in force for ${receivedOn}, so a payment in ZiG cannot be taken for a US dollar charge. Set the rate first.`, 422);
      zig = { zigCents: input.zigAmount, rateId: row.id, rate: Number(row.usdToZig) };
    }

    const created: { id: string; receiptNumber: string | null; ackNumber: string; fundId: string | null; amountCents: number; status: string }[] = [];
    for (const line of input.lines) {
      const fund = line.fundId ? await activeFund(tx, user.schoolId, line.fundId) : null;
      const amountCents = zig ? Math.round(zig.zigCents / zig.rate) : line.amount!;
      if (amountCents <= 0) throw new ServiceError('The ZiG received is worth less than one cent at that rate', 422);

      const proofLimit = input.currency === 'USD' ? settings.proofAboveUsdCents : settings.proofAboveZigCents;
      if (PROOF_METHODS.has(input.method) && proofLimit !== null && (zig ? zig.zigCents : amountCents) > proofLimit && !input.proofKey) {
        throw new ServiceError('Upload the proof of payment (a photo or PDF) for a bank or mobile-money payment of this size', 422);
      }

      // The same method and reference, or the same payer, amount and method within ten minutes, is probably one payment typed twice.
      if (input.reference) {
        const dup = await tx.finPayment.findFirst({
          where: { schoolId: user.schoolId, method: input.method, reference: { equals: input.reference, mode: 'insensitive' }, status: { not: 'REJECTED' } },
          select: { receivedOn: true, receiptNumber: true, ackNumber: true },
        });
        if (dup) throw new ServiceError(`This looks like a payment already recorded on ${ymd(dup.receivedOn)}, receipt ${dup.receiptNumber ?? dup.ackNumber}.`, 409);
      }
      const recent = await tx.finPayment.findFirst({
        where: { schoolId: user.schoolId, studentId: student.id, amountCents, method: input.method, status: { not: 'REJECTED' }, recordedAt: { gte: new Date(Date.now() - 10 * 60_000) }, voidRow: null },
        select: { receivedOn: true, receiptNumber: true, ackNumber: true },
      });
      if (recent) throw new ServiceError(`This looks like a payment already recorded on ${ymd(recent.receivedOn)}, receipt ${recent.receiptNumber ?? recent.ackNumber}.`, 409);

      if (input.chargeId) {
        const c = await tx.finCharge.findFirst({ where: { id: input.chargeId, schoolId: user.schoolId }, include: { voidRow: true } });
        if (!c || c.voidRow) throw new ServiceError('Charge not found', 404);
        const family = guardianId ? await childrenOf(tx, user.schoolId, guardianId) : [student.id];
        if (!family.includes(c.studentId)) throw new ServiceError('That charge belongs to someone else', 404);
        if (c.currency !== input.currency || (fund && c.fundId !== fund.id)) throw new ServiceError('That charge is in another fund or currency, so this payment cannot be for it', 422);
      }

      const year = Number(receivedOn.slice(0, 4));
      const cash = isCash(input.method);
      const ackNumber = await nextSerial(tx, user.schoolId, year, 'ACK');
      const receiptNumber = cash ? await nextReceiptNumber(tx, user.schoolId, year, fund?.receiptPrefix ?? 'RCP') : null;
      const p = await tx.finPayment.create({
        data: {
          schoolId: user.schoolId, studentId: student.id, guardianId, fundId: fund?.id ?? null, receiptNumber, ackNumber, verifyCode: newVerifyCode(), currency: input.currency, amountCents,
          method: input.method, reference: input.reference, paidBy: input.paidBy, receivedOn: dayOf(receivedOn), backdateReason: input.backdateReason?.trim() || null, note: input.note,
          proofKey: input.proofKey, targetChargeId: input.chargeId ?? null, status: cash ? 'RECEIVED' : 'PENDING', recordedById: user.id,
          paidInZig: !!zig, zigAmountCents: zig?.zigCents ?? null, exchangeRateId: zig?.rateId ?? null,
        },
      });
      await audit(tx, user, 'RECORD_PAYMENT', 'FinPayment', p.id, `Recorded ${input.currency} payment ${receiptNumber ?? ackNumber} for ${student.fullName}${fund ? ` (${fund.name})` : ''}`, undefined, {
        receiptNumber, ackNumber, studentId: student.id, guardianId, fundId: fund?.id ?? null, currency: input.currency, amountCents, method: input.method, reference: input.reference ?? null,
        status: p.status, ...(zig ? { zigAmountCents: zig.zigCents, exchangeRateId: zig.rateId } : {}),
      });
      created.push({ id: p.id, receiptNumber, ackNumber, fundId: fund?.id ?? null, amountCents, status: p.status });
    }
    await tellApprovers(tx, user, 'finance.payments.verify', { title: 'Payment to verify', body: `${student.fullName}: ${created.length} payment(s) recorded`, link: '/finance/payments?status=PENDING' });
    return { payments: created };
  });
}

// ─── Verify, reject, void ────────────────────────────────────────────────────

async function loadPayment(tx: Db, schoolId: string, id: string) {
  const p = await tx.finPayment.findFirst({ where: { id, schoolId }, include: { voidRow: { select: { id: true } }, student: { select: { fullName: true } }, fund: { select: { name: true, receiptPrefix: true } } } });
  if (!p) throw new ServiceError('Payment not found', 404);
  return p;
}

const snapshot = (p: { status: string; verifiedById: string | null; rejectedById: string | null; verifierFallback: boolean; receiptNumber?: string | null }) => ({
  status: p.status, verifiedById: p.verifiedById, rejectedById: p.rejectedById, verifierFallback: p.verifierFallback, receiptNumber: p.receiptNumber ?? null,
});

export const VerifySchema = z.object({
  // Change how the money is shared before verifying it; anything not placed stays as credit.
  splits: z.array(z.object({ chargeId: idSchema, amount: amountSchema })).max(60).optional(),
}).optional();

/** Verifies one payment inside the caller's transaction: official receipt number, allocation, text-message copy. */
export async function verifyPaymentTx(tx: Db, user: Actor, id: string, opts: { splits?: { chargeId: string; amount: number }[]; gateway?: boolean } = {}) {
  const p = await loadPayment(tx, user.schoolId, id);
  if (p.voidRow) throw new ServiceError('This payment was voided', 409);
  if (!(WAITING as readonly string[]).includes(p.status)) throw new ServiceError(`This payment was already ${p.status.toLowerCase()}`, 409);
  // Separation of duties, for everyone including the Owner and Administrators.
  // A Paynow payment is confirmed by the gateway itself (a hash-checked callback); the system user records and verifies it, and the database allows that for no one else.
  const byGateway = opts.gateway === true && p.method === 'PAYNOW';
  if (!byGateway && p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must verify it.', 403);
  if (opts.splits?.length && !holds(user, 'finance.payments.allocate')) throw new ServiceError('Forbidden', 403);
  // Held only through the single-person-finance rule: the school has no separate finance person for this step. The cash-up report says so.
  const fallback = !byGateway && effectiveOf(user).viaRule?.has('finance.payments.verify') === true;
  const year = Number(ymd(p.receivedOn).slice(0, 4));
  const receiptNumber = p.receiptNumber ?? (await nextReceiptNumber(tx, user.schoolId, year, p.fund?.receiptPrefix ?? 'RCP'));
  const moved = await tx.finPayment.updateMany({
    where: { id, schoolId: user.schoolId, status: { in: [...WAITING] } },
    data: { status: 'VERIFIED', receiptNumber, verifiedById: user.id, verifiedAt: new Date(), verifierFallback: fallback },
  });
  if (moved.count !== 1) throw new ServiceError('This payment was just decided by someone else', 409);

  let allocated: Allocated[];
  if (opts.splits?.length) {
    const lines = await chargeLines(tx, user.schoolId, { studentIds: p.guardianId ? await childrenOf(tx, user.schoolId, p.guardianId) : [p.studentId], currency: p.currency });
    const sum = opts.splits.reduce((s, x) => s + x.amount, 0);
    if (sum > p.amountCents) throw new ServiceError('That is more than the payment holds', 409);
    for (const sp of opts.splits) {
      const line = lines.find((l) => l.chargeId === sp.chargeId);
      if (!line || (p.fundId && line.fundId !== p.fundId)) throw new ServiceError('A charge is of another learner, fund or currency, or was voided', 409);
      if (sp.amount > line.outstanding) throw new ServiceError('That is more than the charge still owes', 409);
    }
    await tx.finPaymentAllocation.createMany({ data: opts.splits.map((sp) => ({ schoolId: user.schoolId, paymentId: id, chargeId: sp.chargeId, amountCents: sp.amount, createdById: user.id })) });
    allocated = opts.splits.map((sp) => ({ paymentId: id, chargeId: sp.chargeId, amountCents: sp.amount }));
  } else {
    allocated = await applyCreditTx(tx, user, p.studentId, { paymentId: id });
  }
  const total = allocated.reduce((s, a) => s + a.amountCents, 0);
  await audit(tx, user, 'VERIFY_PAYMENT', 'FinPayment', id, `Verified receipt ${receiptNumber} for ${p.student.fullName}${fallback ? ' (verified by the Owner or Administrator: no other finance person)' : ''}`,
    snapshot(p), { ...snapshot({ status: 'VERIFIED', verifiedById: user.id, rejectedById: null, verifierFallback: fallback, receiptNumber }), allocatedCents: total, allocations: allocated.length });

  // A text-message copy of the receipt to the fee payer (when Communication is on).
  if (p.method !== 'CREDIT_TRANSFER') {
    const contacts = await feePayerContacts(tx, user.schoolId, p.studentId);
    await queueSms(tx, user.schoolId, contacts, `Receipt ${receiptNumber}: ${formatMoney(p.amountCents, p.currency)} received for ${p.student.fullName}. Thank you.`, { studentId: p.studentId, key: `receipt:${id}` });
  }
  return { id, receiptNumber, allocatedCents: total, creditCents: p.amountCents - total, verifierFallback: fallback, studentId: p.studentId };
}

export async function verifyPayment(user: Actor, id: string, raw?: unknown) {
  need(user, 'finance.payments.verify');
  const input = VerifySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx((tx) => verifyPaymentTx(tx, user, id, { splits: input?.splits?.map((x) => ({ chargeId: x.chargeId, amount: x.amount })) }));
}

export async function rejectPayment(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.payments.verify');
  const reason = whySchema(5).parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await loadPayment(tx, user.schoolId, id);
    if (p.voidRow) throw new ServiceError('This payment was voided', 409);
    if (!(WAITING as readonly string[]).includes(p.status)) throw new ServiceError(`This payment was already ${p.status.toLowerCase()}`, 409);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must decide on it.', 403);
    const moved = await tx.finPayment.updateMany({ where: { id, schoolId: user.schoolId, status: { in: [...WAITING] } }, data: { status: 'REJECTED', rejectedById: user.id, rejectedAt: new Date(), rejectionReason: reason } });
    if (moved.count !== 1) throw new ServiceError('This payment was just decided by someone else', 409);
    await audit(tx, user, 'REJECT_PAYMENT', 'FinPayment', id, `Rejected ${p.receiptNumber ?? p.ackNumber}: ${reason}`, snapshot(p), { ...snapshot({ status: 'REJECTED', verifiedById: null, rejectedById: user.id, verifierFallback: false }), reason });
    return { id };
  });
}

/** Only the Owner voids a payment, never one they recorded themselves. Its allocations stop counting, so the charges are unpaid again. */
export async function voidPayment(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.payments.void');
  const reason = whySchema().parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await loadPayment(tx, user.schoolId, id);
    if (p.voidRow) throw new ServiceError('This payment was already voided', 409);
    if (p.status === 'REJECTED') throw new ServiceError('A rejected payment never counted, so there is nothing to void', 409);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must void it.', 403);
    if (await tx.finRefund.count({ where: { schoolId: user.schoolId, paymentId: id, status: { not: 'REJECTED' } } })) {
      throw new ServiceError('This payment has a refund against it, so it cannot be voided', 409);
    }
    if (await tx.creditTransfer.count({ where: { schoolId: user.schoolId, fromPaymentId: id } })) {
      throw new ServiceError('Credit from this payment was moved to a brother or sister, so it cannot be voided', 409);
    }
    const v = await tx.finVoid.create({ data: { schoolId: user.schoolId, paymentId: id, reason, voidedById: user.id } });
    await audit(tx, user, 'VOID_PAYMENT', 'FinPayment', id, `Voided ${p.receiptNumber ?? p.ackNumber} for ${p.student.fullName}: ${reason}`, snapshot(p), { ...snapshot(p), voided: true, voidId: v.id, reason });
    return { id, voidId: v.id };
  });
}

/** Directs part of a verified payment at particular charges (instead of the school's order). Not by the person who recorded it. */
export const AllocateSchema = z.object({ splits: z.array(z.object({ chargeId: idSchema, amount: amountSchema })).min(1).max(60) });

export async function allocatePayment(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.payments.allocate', 'finance.payments.verify');
  const input = AllocateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await loadPayment(tx, user.schoolId, id);
    if (p.recordedById === user.id) throw new ServiceError('You recorded this payment, so someone else must allocate it.', 403);
    if (p.status !== 'VERIFIED' || p.voidRow) throw new ServiceError('Only a verified payment can be allocated', 409);
    const scope = p.guardianId ? await childrenOf(tx, user.schoolId, p.guardianId) : [p.studentId];
    const [credit] = (await paymentCredits(tx, user.schoolId, { studentIds: [p.studentId] })).filter((c) => c.paymentId === id);
    const lines = await chargeLines(tx, user.schoolId, { studentIds: scope, currency: p.currency });
    const wanted = input.splits.reduce((s, x) => s + x.amount, 0);
    if (wanted > (credit?.creditCents ?? 0)) throw new ServiceError('That is more than the payment has left to allocate', 409);
    for (const split of input.splits) {
      const line = lines.find((l) => l.chargeId === split.chargeId);
      if (!line || (p.fundId && line.fundId !== p.fundId)) throw new ServiceError('A charge is of another learner, fund or currency, or was voided', 409);
      if (split.amount > line.outstanding) throw new ServiceError('That is more than the charge still owes', 409);
    }
    await tx.finPaymentAllocation.createMany({ data: input.splits.map((s) => ({ schoolId: user.schoolId, paymentId: id, chargeId: s.chargeId, amountCents: s.amount, createdById: user.id })) });
    await audit(tx, user, 'ALLOCATE_PAYMENT', 'FinPayment', id, `Allocated ${wanted} cents of ${p.receiptNumber ?? p.ackNumber} to ${input.splits.length} charge(s)`, undefined, { splits: input.splits.map((s) => ({ chargeId: s.chargeId, amountCents: s.amount })) });
    return { id, allocatedCents: wanted };
  });
}

/** Uses the credit a learner or family holds on what they owe now (when the school does not do it at billing). */
export async function applyCredit(user: Actor, studentId: string) {
  need(user, 'finance.payments.allocate', 'finance.payments.verify', 'finance.billing.run');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (!(await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Student not found', 404);
    const done = await applyCreditTx(tx, user, studentId);
    const total = done.reduce((s, a) => s + a.amountCents, 0);
    if (done.length) await audit(tx, user, 'ALLOCATE_PAYMENT', 'Student', studentId, `Used ${total} cents of credit on what is owed`, undefined, { allocations: done.length, cents: total });
    return { allocatedCents: total };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface PaymentRow {
  id: string;
  /** The official receipt number, once there is one; the acknowledgement slip before that. */
  receiptNumber: string | null;
  ackNumber: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  guardianId: string | null;
  fundId: string | null;
  fundName: string;
  currency: Cur;
  amountCents: number;
  allocatedCents: number;
  method: Method;
  reference: string | null;
  paidBy: string | null;
  receivedOn: string;
  status: 'PENDING' | 'RECEIVED' | 'VERIFIED' | 'REJECTED';
  voided: boolean;
  voidReason: string | null;
  recordedBy: string | null;
  recordedById: string;
  verifiedBy: string | null;
  verifierFallback: boolean;
  rejectionReason: string | null;
  note: string | null;
  hasProof: boolean;
  paidInZig: boolean;
  zigAmountCents: number | null;
}

export interface PaymentFilter {
  /** WAITING / PENDING mean received or pending (not yet verified). */
  status?: 'PENDING' | 'WAITING' | 'RECEIVED' | 'VERIFIED' | 'REJECTED' | 'VOIDED';
  fundId?: string;
  currency?: Cur;
  method?: string;
  from?: string;
  to?: string;
  studentId?: string;
  recordedById?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

const PAYMENT_READ_KEYS = ['finance.payments.view', 'finance.payments.verify', 'finance.payments.record'] as const;

/**
 * The payments this person may see. A school-wide grant of any of the three keys sees them all; a clerk, whose payments.view and
 * payments.record are held at RECORDED_BY_ME, sees only the ones they recorded.
 */
async function visiblePayments(tx: Db, user: Actor): Promise<Prisma.FinPaymentWhereInput> {
  const eff = effectiveOf(user);
  if (PAYMENT_READ_KEYS.some((k) => grantsFor(eff, k).some((g) => g.scope === 'SCHOOL'))) return {};
  const branches: Prisma.FinPaymentWhereInput[] = [];
  for (const key of PAYMENT_READ_KEYS) if (grantsFor(eff, key).length) branches.push((await scopeWhere(user, key, 'FinPayment', tx)) as Prisma.FinPaymentWhereInput);
  return branches.length ? { OR: branches } : { id: { in: [] } };
}

export async function listPayments(user: Actor, f: PaymentFilter = {}) {
  need(user, 'finance.payments.view', 'finance.payments.verify', 'finance.payments.record');
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const and: Prisma.FinPaymentWhereInput[] = [{ schoolId: user.schoolId }, await visiblePayments(tx, user)];
    if (f.status === 'VOIDED') and.push({ voidRow: { isNot: null } });
    else if (f.status === 'PENDING' || f.status === 'WAITING') and.push({ status: { in: [...WAITING] }, voidRow: null });
    else if (f.status) and.push({ status: f.status, voidRow: null });
    if (f.fundId) and.push({ fundId: f.fundId });
    if (f.currency) and.push({ currency: f.currency });
    if (f.method) and.push({ method: f.method as never });
    if (f.studentId) and.push({ OR: [{ studentId: f.studentId }, { allocations: { some: { charge: { studentId: f.studentId } } } }] });
    if (f.recordedById) and.push({ recordedById: f.recordedById });
    if (f.from) and.push({ receivedOn: { gte: dayOf(f.from) } });
    if (f.to) and.push({ receivedOn: { lte: dayOf(f.to) } });
    if (f.q?.trim()) {
      const q = f.q.trim();
      and.push({ OR: [{ receiptNumber: { contains: q, mode: 'insensitive' } }, { ackNumber: { contains: q, mode: 'insensitive' } }, { reference: { contains: q, mode: 'insensitive' } }, { student: { fullName: { contains: q, mode: 'insensitive' } } }, { student: { admissionNumber: { contains: q, mode: 'insensitive' } } }] });
    }
    const where: Prisma.FinPaymentWhereInput = { AND: and };
    const [total, rows] = await Promise.all([
      tx.finPayment.count({ where }),
      tx.finPayment.findMany({
        where, orderBy: [{ receivedOn: 'desc' }, { recordedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        include: { student: { select: { fullName: true, admissionNumber: true } }, fund: { select: { name: true } }, voidRow: { select: { reason: true } }, allocations: { select: { amountCents: true } } },
      }),
    ]);
    const names = await nameMap(tx, user.schoolId, rows.flatMap((r) => [r.recordedById, r.verifiedById]));
    const out: PaymentRow[] = rows.map((r) => ({
      id: r.id, receiptNumber: r.receiptNumber, ackNumber: r.ackNumber, studentId: r.studentId, studentName: r.student.fullName, admissionNumber: r.student.admissionNumber, guardianId: r.guardianId,
      fundId: r.fundId, fundName: r.fund?.name ?? 'Any fund', currency: r.currency, amountCents: r.amountCents, allocatedCents: r.allocations.reduce((s, a) => s + a.amountCents, 0),
      method: r.method as Method, reference: r.reference, paidBy: r.paidBy, receivedOn: ymd(r.receivedOn), status: r.status, voided: !!r.voidRow, voidReason: r.voidRow?.reason ?? null,
      recordedBy: nameOf(names, r.recordedById), recordedById: r.recordedById, verifiedBy: nameOf(names, r.verifiedById), verifierFallback: r.verifierFallback, rejectionReason: r.rejectionReason,
      note: r.note, hasProof: !!r.proofKey, paidInZig: r.paidInZig, zigAmountCents: r.zigAmountCents,
    }));
    return { rows: out, total, page, pageSize };
  });
}

export interface ReceiptView {
  school: string; schoolAddress: string | null; schoolPhone: string | null; logoUrl: string | null;
  id: string; receiptNumber: string | null; ackNumber: string; verifyCode: string; studentName: string; admissionNumber: string; className: string | null; fundName: string; currency: Cur;
  amountCents: number; method: Method; reference: string | null; paidBy: string | null; receivedOn: string; status: string; voided: boolean; recordedBy: string | null; verifiedBy: string | null;
  allocations: { description: string; studentName: string; amountCents: number }[];
  /** Received ZiG 3,240.00 at 27.00 = US$120.00 */
  zig: { zigAmountCents: number; rate: number } | null;
  /** What the learner (or family) still owes after this payment, per currency. */
  balanceRemaining: Record<Cur, number>;
}

/** One payment with everything the printed receipt shows. */
export async function getReceipt(user: Actor, id: string): Promise<ReceiptView> {
  need(user, 'finance.payments.view', 'finance.payments.record', 'finance.payments.verify');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.finPayment.findFirst({
      where: { id, schoolId: user.schoolId, ...(await visiblePayments(tx, user)) },
      include: {
        student: { select: { fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } }, fund: { select: { name: true } }, voidRow: { select: { reason: true } },
        allocations: { select: { amountCents: true, charge: { select: { description: true, student: { select: { fullName: true } } } } } },
      },
    });
    if (!p) throw new ServiceError('Payment not found', 404);
    const school = await tx.school.findUnique({ where: { id: user.schoolId }, select: { name: true, address: true, phone: true, logoUrl: true } });
    const names = await nameMap(tx, user.schoolId, [p.recordedById, p.verifiedById]);
    const rate = p.exchangeRateId ? await tx.exchangeRate.findFirst({ where: { id: p.exchangeRateId }, select: { usdToZig: true } }) : null;
    const kids = p.guardianId ? await childrenOf(tx, user.schoolId, p.guardianId) : [p.studentId];
    const lines = await chargeLines(tx, user.schoolId, { studentIds: kids });
    const remaining: Record<Cur, number> = { USD: 0, ZIG: 0 };
    for (const l of lines) remaining[l.currency] += l.outstanding;
    return {
      school: school?.name ?? '', schoolAddress: school?.address ?? null, schoolPhone: school?.phone ?? null, logoUrl: school?.logoUrl ?? null,
      id: p.id, receiptNumber: p.receiptNumber, ackNumber: p.ackNumber, verifyCode: p.verifyCode, studentName: p.student.fullName, admissionNumber: p.student.admissionNumber,
      className: p.student.currentClass?.name ?? null, fundName: p.fund?.name ?? 'Any fund', currency: p.currency as Cur, amountCents: p.amountCents, method: p.method as Method, reference: p.reference,
      paidBy: p.paidBy, receivedOn: ymd(p.receivedOn), status: p.status, voided: !!p.voidRow, recordedBy: nameOf(names, p.recordedById), verifiedBy: nameOf(names, p.verifiedById),
      allocations: p.allocations.map((a) => ({ description: a.charge.description, studentName: a.charge.student.fullName, amountCents: a.amountCents })),
      zig: p.paidInZig && p.zigAmountCents && rate ? { zigAmountCents: p.zigAmountCents, rate: Number(rate.usdToZig) } : null,
      balanceRemaining: remaining,
    };
  });
}

export { CLERK_METHODS };
export type { CreditLine };
