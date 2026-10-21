// Discounts and waivers: the school gives up the money. A rule is a fixed amount or a percentage of chosen fee items, for one term or standing
// (applied automatically at every billing until an end term). The bursar creates it, the Head approves it, never the same person. A pending
// rule changes no balance. Each application is an ordinary adjustment on a charge, so it shows on statements and in the audit log.
import { chargeLines } from '@/lib/finance/balances';
import { z } from 'zod';
import type { AdjustmentKind, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { amountSchema, assertCurrencyOn, audit, currencySchema, idSchema, loadFinSettings, nameMap, nameOf, need, tellApprovers, whySchema, type Actor } from '@/lib/finance/common';
import { percentOf, type Cur } from '@/lib/finance/money';
import { notifyUsers } from '@/lib/system/notifications';

export const RULE_KINDS = ['SIBLING', 'STAFF_CHILD', 'EARLY_PAYMENT', 'HARDSHIP', 'HEAD_DISCRETION', 'CORRECTION'] as const;
export const RULE_LABEL: Record<string, string> = {
  SIBLING: 'Sibling discount', STAFF_CHILD: 'Staff child', EARLY_PAYMENT: 'Early payment', HARDSHIP: 'Hardship waiver', HEAD_DISCRETION: "Head's discretion", CORRECTION: 'Correction',
  CREDIT_NOTE: 'Credit note', DISCOUNT: 'Discount', BURSARY: 'Bursary', WAIVER: 'Waiver', SPONSOR: 'Covered by a sponsor',
};

export const RuleSchema = z.object({
  studentId: idSchema,
  kind: z.enum(RULE_KINDS),
  amount: amountSchema.optional(),
  percent: z.number().min(0.01).max(100).optional(),
  currency: currencySchema.optional(),
  catalogItemIds: z.array(idSchema).max(30).default([]),
  termFromId: idSchema.optional(),
  termToId: idSchema.optional(),
  standing: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false),
  reason: whySchema(5),
}).superRefine((v, ctx) => {
  if ((v.amount === undefined) === (v.percent === undefined)) ctx.addIssue({ code: 'custom', message: 'Give either a fixed amount or a percentage', path: ['amount'] });
  if (v.amount !== undefined && !v.currency) ctx.addIssue({ code: 'custom', message: 'Choose the currency of the amount', path: ['currency'] });
});

export async function createRule(user: Actor, raw: unknown) {
  need(user, 'finance.adjustments.create');
  const input = RuleSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const student = await tx.student.findFirst({ where: { id: input.studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!student) throw new ServiceError('Student not found', 404);
    const from = input.termFromId ? await tx.academicTerm.findFirst({ where: { id: input.termFromId, schoolId: user.schoolId } }) : await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
    if (!from) throw new ServiceError('Term not found', 404);
    const to = input.termToId ? await tx.academicTerm.findFirst({ where: { id: input.termToId, schoolId: user.schoolId } }) : null;
    if (input.termToId && !to) throw new ServiceError('Term not found', 404);
    if (to && to.startDate < from.startDate) throw new ServiceError('The end term is before the start term', 422);
    if (input.currency) await assertCurrencyOn(tx, user.schoolId, input.currency);
    if (input.catalogItemIds.length && (await tx.feeItem.count({ where: { schoolId: user.schoolId, id: { in: input.catalogItemIds } } })) !== input.catalogItemIds.length) throw new ServiceError('Fee item not found', 404);
    const r = await tx.discountRule.create({
      data: {
        schoolId: user.schoolId, studentId: student.id, kind: input.kind, amountCents: input.amount ?? null, percentBps: input.percent !== undefined ? Math.round(input.percent * 100) : null, currency: input.currency ?? null,
        catalogItemIds: input.catalogItemIds, termFromId: from.id, termToId: to?.id ?? null, standing: input.standing, reason: input.reason, createdById: user.id,
      },
    });
    await audit(tx, user, 'SAVE_DISCOUNT_RULE', 'DiscountRule', r.id, `Asked for a ${RULE_LABEL[input.kind]!.toLowerCase()} for ${student.fullName}`, undefined, {
      kind: input.kind, amountCents: r.amountCents, percentBps: r.percentBps, currency: r.currency, termFromId: from.id, termToId: to?.id ?? null, standing: input.standing, items: input.catalogItemIds.length,
    });
    await tellApprovers(tx, user, 'finance.adjustments.approve', { title: `${RULE_LABEL[input.kind]} to approve`, body: student.fullName, link: '/finance/discounts' });
    return { id: r.id };
  });
}

type Rule = Prisma.DiscountRuleGetPayload<object>;

/** Terms (from the rule's first to its last, or open-ended when standing) that a rule covers, as ids. */
export async function termsCovered(tx: Db, schoolId: string, rule: Pick<Rule, 'termFromId' | 'termToId' | 'standing'>): Promise<string[]> {
  const from = await tx.academicTerm.findFirst({ where: { id: rule.termFromId, schoolId }, select: { startDate: true } });
  if (!from) return [];
  const to = rule.termToId ? await tx.academicTerm.findFirst({ where: { id: rule.termToId, schoolId }, select: { startDate: true } }) : null;
  const terms = await tx.academicTerm.findMany({ where: { schoolId, startDate: { gte: from.startDate, ...(to ? { lte: to.startDate } : rule.standing ? {} : { lte: from.startDate }) } }, select: { id: true } });
  return terms.map((t) => t.id);
}

/** How much a rule takes off one charge of `cents` (never more than `room`). */
export const discountOn = (rule: Pick<Rule, 'amountCents' | 'percentBps'>, cents: number, room: number): number => {
  const raw = rule.percentBps !== null ? percentOf(cents, rule.percentBps) : Math.min(rule.amountCents ?? 0, cents);
  return Math.max(0, Math.min(raw, room));
};

/** Turns pending adjustments into approved ones, in the names of the two people who asked for and approved them. */
export async function approveAdjustments(tx: Db, schoolId: string, rows: { id: string }[], decidedById: string, note: string) {
  if (rows.length === 0) return;
  await tx.finAdjustment.updateMany({ where: { schoolId, id: { in: rows.map((r) => r.id) }, status: 'PENDING' }, data: { status: 'APPROVED', decidedById, decidedAt: new Date(), decisionNote: note } });
}

/** An approved rule reaches charges already made in the terms it covers. */
async function applyToExisting(tx: Db, schoolId: string, rule: Rule, approverId: string) {
  const termIds = await termsCovered(tx, schoolId, rule);
  if (termIds.length === 0) return 0;
  const charges = await tx.finCharge.findMany({
    where: { schoolId, studentId: rule.studentId, termId: { in: termIds }, voidRow: null, ...(rule.currency ? { currency: rule.currency } : {}), ...(rule.catalogItemIds.length ? { catalogItemId: { in: rule.catalogItemIds } } : {}), NOT: { adjustments: { some: { ruleId: rule.id } } } },
    include: { adjustments: { where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { amountCents: true } } },
    orderBy: { createdAt: 'asc' },
  });
  // Money already paid against a charge cannot be discounted away: only what is still owed can be taken off.
  const owedNow = new Map((await chargeLines(tx, schoolId, { studentIds: [rule.studentId] })).map((l) => [l.chargeId, l.outstanding]));
  let fixedLeft = rule.amountCents ?? 0;
  const made: { id: string }[] = [];
  for (const c of charges) {
    const room = Math.min(c.amountCents - c.adjustments.reduce((s, a) => s + a.amountCents, 0), owedNow.get(c.id) ?? 0);
    const want = rule.percentBps !== null ? discountOn(rule, c.amountCents, room) : Math.min(fixedLeft, room);
    if (want <= 0) continue;
    if (rule.percentBps === null) fixedLeft -= want;
    const a = await tx.finAdjustment.create({ data: { schoolId, chargeId: c.id, kind: rule.kind, amountCents: want, percentBps: rule.percentBps, ruleId: rule.id, reason: rule.reason.length >= 5 ? rule.reason : 'Discount', createdById: rule.createdById } });
    made.push(a);
  }
  await approveAdjustments(tx, schoolId, made, approverId, 'Approved with the rule');
  return made.length;
}

export async function decideRule(user: Actor, id: string, decision: 'approve' | 'reject', rawNote?: unknown) {
  need(user, 'finance.adjustments.approve');
  const note = rawNote === undefined || rawNote === '' ? undefined : whySchema(3).parse(rawNote);
  if (decision === 'reject' && !note) throw new ServiceError('Give a reason for rejecting it', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.discountRule.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Discount not found', 404);
    if (r.status !== 'PENDING') throw new ServiceError(`This was already ${r.status.toLowerCase()}`, 409);
    if (r.createdById === user.id) throw new ServiceError('You asked for this, so someone else must decide on it.', 403);
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    await tx.discountRule.update({ where: { id }, data: { status, decidedById: user.id, decidedAt: new Date(), decisionNote: note } });
    const applied = decision === 'approve' ? await applyToExisting(tx, user.schoolId, r, user.id) : 0;
    await audit(tx, user, 'DECIDE_DISCOUNT_RULE', 'DiscountRule', id, `${decision === 'approve' ? 'Approved' : 'Rejected'} the ${RULE_LABEL[r.kind]!.toLowerCase()}`, { status: 'PENDING' }, { status, decidedById: user.id, appliedToCharges: applied, note: note ?? null });
    await notifyUsers(tx, user.schoolId, [r.createdById], { type: 'FINANCE', title: `${RULE_LABEL[r.kind]} ${status.toLowerCase()}`, link: '/finance/discounts' });
    return { id, status, applied };
  });
}

/** Ends a standing discount: it is not applied from the term after this one. */
export async function endRule(user: Actor, id: string, termToId?: string) {
  need(user, 'finance.adjustments.approve', 'finance.adjustments.create');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.discountRule.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Discount not found', 404);
    if (r.status !== 'APPROVED') throw new ServiceError('Only an approved discount can be ended', 409);
    const term = termToId ? await tx.academicTerm.findFirst({ where: { id: termToId, schoolId: user.schoolId } }) : await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
    if (!term) throw new ServiceError('Term not found', 404);
    await tx.discountRule.update({ where: { id }, data: { termToId: term.id } });
    await audit(tx, user, 'SAVE_DISCOUNT_RULE', 'DiscountRule', id, 'Ended a standing discount', { termToId: r.termToId }, { termToId: term.id });
    return { id };
  });
}

export interface RuleRow {
  id: string; studentId: string; studentName: string; kind: string; kindLabel: string; amountCents: number | null; percent: number | null; currency: Cur | null; standing: boolean;
  termFrom: string; termTo: string | null; items: string[]; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdBy: string | null; createdById: string; decidedBy: string | null; decisionNote: string | null;
}

export async function listRules(user: Actor, f: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; studentId?: string } = {}) {
  need(user, 'finance.adjustments.create', 'finance.adjustments.approve', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.discountRule.findMany({ where: { schoolId: user.schoolId, ...(f.status ? { status: f.status } : {}), ...(f.studentId ? { studentId: f.studentId } : {}) }, orderBy: { createdAt: 'desc' }, take: 300 });
    const [students, terms, items, names] = await Promise.all([
      tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true } }),
      tx.academicTerm.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      tx.feeItem.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      nameMap(tx, user.schoolId, rows.flatMap((r) => [r.createdById, r.decidedById])),
    ]);
    const sn = new Map(students.map((s) => [s.id, s.fullName])); const tn = new Map(terms.map((t) => [t.id, t.name])); const itn = new Map(items.map((i) => [i.id, i.name]));
    const out: RuleRow[] = rows.map((r) => ({
      id: r.id, studentId: r.studentId, studentName: sn.get(r.studentId) ?? '', kind: r.kind, kindLabel: RULE_LABEL[r.kind] ?? r.kind, amountCents: r.amountCents, percent: r.percentBps !== null ? r.percentBps / 100 : null,
      currency: r.currency, standing: r.standing, termFrom: tn.get(r.termFromId) ?? '', termTo: r.termToId ? (tn.get(r.termToId) ?? null) : null, items: r.catalogItemIds.map((i) => itn.get(i) ?? ''),
      reason: r.reason, status: r.status, createdBy: nameOf(names, r.createdById), createdById: r.createdById, decidedBy: nameOf(names, r.decidedById), decisionNote: r.decisionNote,
    }));
    return out;
  });
}

// ─── The sibling discount rule (a school setting) ────────────────────────────

export const SiblingSchema = z.object({
  pct2: z.number().min(0).max(100), pct3: z.number().min(0).max(100), catalogItemIds: z.array(idSchema).max(30).default([]),
});

export async function getSiblingRule(user: Actor) {
  need(user, 'finance.fees.view', 'finance.fees.manage', 'finance.adjustments.approve', 'finance.billing.run');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await loadFinSettings(tx, user.schoolId);
    const names = await nameMap(tx, user.schoolId, [s.siblingSetById, s.siblingApprovedById]);
    return { pct2: (s.siblingPct2Bps ?? 0) / 100, pct3: (s.siblingPct3Bps ?? 0) / 100, catalogItemIds: s.siblingItemIds, setBy: nameOf(names, s.siblingSetById), setById: s.siblingSetById, approvedBy: nameOf(names, s.siblingApprovedById), approved: !!s.siblingApprovedById };
  });
}

/** The bursar sets the percentages; they apply from the next billing once the Head approves them. */
export async function saveSiblingRule(user: Actor, raw: unknown) {
  need(user, 'finance.fees.manage');
  const input = SiblingSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await loadFinSettings(tx, user.schoolId);
    await tx.finSettings.update({
      where: { schoolId: user.schoolId },
      data: { siblingPct2Bps: Math.round(input.pct2 * 100), siblingPct3Bps: Math.round(input.pct3 * 100), siblingItemIds: input.catalogItemIds, siblingSetById: user.id, siblingApprovedById: null },
    });
    await audit(tx, user, 'SAVE_FINANCE_CONTROLS', 'FinSettings', before.id, 'Set the sibling discount rule', { pct2Bps: before.siblingPct2Bps, pct3Bps: before.siblingPct3Bps, approved: !!before.siblingApprovedById }, { pct2: input.pct2, pct3: input.pct3, items: input.catalogItemIds.length, approved: false });
    await tellApprovers(tx, user, 'finance.adjustments.approve', { title: 'Sibling discount rule to approve', link: '/finance/discounts' });
    return { ok: true };
  });
}

export async function approveSiblingRule(user: Actor) {
  need(user, 'finance.adjustments.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await loadFinSettings(tx, user.schoolId);
    if (!s.siblingSetById) throw new ServiceError('There is no sibling discount rule to approve', 409);
    if (s.siblingApprovedById) throw new ServiceError('The rule is already approved', 409);
    if (s.siblingSetById === user.id) throw new ServiceError('You set this rule, so someone else must approve it.', 403);
    await tx.finSettings.update({ where: { schoolId: user.schoolId }, data: { siblingApprovedById: user.id } });
    await audit(tx, user, 'SAVE_FINANCE_CONTROLS', 'FinSettings', s.id, 'Approved the sibling discount rule', { approved: false }, { approved: true, approvedById: user.id });
    return { ok: true };
  });
}

export type { AdjustmentKind };
