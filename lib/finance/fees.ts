// One-off charges and corrections. Term fees come from the approved fee structure (lib/finance/billing.ts). Here: a charge for one learner or a
// selected group (a trip, a lost textbook, a library fine). A charge is never edited or deleted: a wrong amount is lowered with an approved
// adjustment; a charge that was wrong altogether is voided by the Owner, with a reason, and only while no payment is allocated to it.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import {
  activeFund, amountSchema, assertCurrencyOn, audit, currencySchema, dayOf, ensureFunds, idSchema, isoDateSchema, need, textSchema, whySchema, writableTerm, type Actor,
} from '@/lib/finance/common';
import { applyCreditIfAllowed } from '@/lib/finance/payments';

export const OneOffSchema = z.object({
  termId: idSchema.optional(),
  catalogItemId: idSchema.optional(),
  fundId: idSchema.optional(),
  description: textSchema('what the charge is for', 1, 120).optional(),
  currency: currencySchema,
  amount: amountSchema,
  dueDate: isoDateSchema.optional(),
}).superRefine((v, ctx) => {
  if (!v.catalogItemId && !v.fundId) ctx.addIssue({ code: 'custom', message: 'Choose the fee item (or the fund)', path: ['catalogItemId'] });
  if (!v.catalogItemId && !v.description) ctx.addIssue({ code: 'custom', message: 'Say what the charge is for', path: ['description'] });
});

async function oneOffTarget(tx: Parameters<Parameters<ReturnType<typeof getScopedDb>['$tx']>[0]>[0], user: Actor, input: z.infer<typeof OneOffSchema>) {
  await ensureFunds(tx, user.schoolId);
  const item = input.catalogItemId ? await tx.feeItem.findFirst({ where: { id: input.catalogItemId, schoolId: user.schoolId } }) : null;
  if (input.catalogItemId && (!item || !item.active)) throw new ServiceError('Fee item not found', 404);
  const fund = await activeFund(tx, user.schoolId, item?.fundId ?? input.fundId!);
  await assertCurrencyOn(tx, user.schoolId, input.currency);
  return { item, fund, description: input.description ?? item!.name };
}

/** A single charge to one learner. */
export async function addCharge(user: Actor, studentId: string, raw: unknown, source: 'MANUAL' | 'LIBRARY' | 'EXAM_ENTRY' | 'ONE_OFF' = 'MANUAL') {
  need(user, 'finance.charges.create');
  const input = OneOffSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const { item, fund, description } = await oneOffTarget(tx, user, input);
    const c = await tx.finCharge.create({
      data: {
        schoolId: user.schoolId, studentId, termId: term.id, fundId: fund.id, catalogItemId: item?.id ?? null, description, currency: input.currency, amountCents: input.amount, source,
        dueDate: input.dueDate ? dayOf(input.dueDate) : null, createdById: user.id,
      },
    });
    const applied = await applyCreditIfAllowed(tx, user, studentId);
    await audit(tx, user, 'APPLY_CHARGE', 'FinCharge', c.id, `Charged ${student.fullName} ${description} (${fund.name}, ${term.name})`, undefined, {
      studentId, termId: term.id, fundId: fund.id, description, currency: c.currency, amountCents: c.amountCents, source, creditAppliedCents: applied.reduce((s, a) => s + a.amountCents, 0),
    });
    return { id: c.id };
  });
}

export const GroupChargeSchema = OneOffSchema.and(z.object({
  studentIds: z.array(idSchema).min(1).max(2000).optional(),
  classId: idSchema.optional(),
  levelId: idSchema.optional(),
}));

/** The same charge to a selected group: chosen learners, a class or a form (active learners enrolled in the term). */
export async function addGroupCharge(user: Actor, raw: unknown) {
  need(user, 'finance.charges.create');
  const input = GroupChargeSchema.parse(raw);
  if (!input.studentIds && !input.classId && !input.levelId) throw new ServiceError('Choose the learners: some names, a class or a form', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const { item, fund, description } = await oneOffTarget(tx, user, input);
    const enrolments = await tx.enrollment.findMany({
      where: {
        schoolId: user.schoolId, termId: term.id, status: 'ACTIVE', student: { status: 'ACTIVE' },
        ...(input.studentIds ? { studentId: { in: input.studentIds } } : {}), ...(input.classId ? { classId: input.classId } : {}), ...(input.levelId ? { class: { levelId: input.levelId } } : {}),
      },
      select: { studentId: true },
    });
    if (input.studentIds && enrolments.length !== new Set(input.studentIds).size) throw new ServiceError('Some of those learners are not active in this term', 422);
    if (enrolments.length === 0) throw new ServiceError('No active learner matches', 409);
    await tx.finCharge.createMany({
      data: enrolments.map((e) => ({
        schoolId: user.schoolId, studentId: e.studentId, termId: term.id, fundId: fund.id, catalogItemId: item?.id ?? null, description, currency: input.currency, amountCents: input.amount,
        source: 'ONE_OFF' as const, dueDate: input.dueDate ? dayOf(input.dueDate) : null, createdById: user.id,
      })),
    });
    let applied = 0;
    for (const e of enrolments) applied += (await applyCreditIfAllowed(tx, user, e.studentId)).reduce((s, a) => s + a.amountCents, 0);
    await audit(tx, user, 'APPLY_CHARGE', 'AcademicTerm', term.id, `Charged ${enrolments.length} learner(s) ${description} (${fund.name}, ${term.name})`, undefined, {
      learners: enrolments.length, fundId: fund.id, description, currency: input.currency, amountCents: input.amount, creditAppliedCents: applied,
    });
    return { charged: enrolments.length };
  });
}

/** A charge made in error, with nothing paid or adjusted against it, is voided by the Owner; otherwise an adjustment is the way. */
export async function voidCharge(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.charges.void');
  const reason = whySchema().parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.finCharge.findFirst({ where: { id, schoolId: user.schoolId }, include: { voidRow: true, term: true, student: { select: { fullName: true } } } });
    if (!c) throw new ServiceError('Charge not found', 404);
    if (c.voidRow) throw new ServiceError('This charge was already voided', 409);
    if (c.term.status === 'CLOSED') throw new ServiceError(`${c.term.name} is closed, so its charges cannot be voided. Use a credit note.`, 409);
    if (c.createdById && c.createdById === user.id) throw new ServiceError('You made this charge, so someone else must void it.', 403);
    const live = await tx.finPaymentAllocation.count({ where: { schoolId: user.schoolId, chargeId: id, payment: { voidRow: null } } });
    const adj = await tx.finAdjustment.count({ where: { schoolId: user.schoolId, chargeId: id, status: { not: 'REJECTED' } } });
    if (live > 0 || adj > 0) throw new ServiceError('Payments or credit notes are already against this charge, so it cannot be voided. Use a credit note.', 409);
    const v = await tx.finVoid.create({ data: { schoolId: user.schoolId, chargeId: id, reason, voidedById: user.id } });
    await audit(tx, user, 'VOID_CHARGE', 'FinCharge', id, `Voided charge ${c.description} for ${c.student.fullName}: ${reason}`, { description: c.description, amountCents: c.amountCents, currency: c.currency, voided: false }, { voided: true, voidId: v.id, reason });
    return { id, voidId: v.id };
  });
}
