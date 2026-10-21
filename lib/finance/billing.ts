// Billing turns the approved fee structure into charges on each learner's account, once per term, and can never charge anyone twice (a unique
// constraint on learner and fee line). The preview shows every learner, the lines that apply, the standing discounts, the sibling discount and
// the sponsor awards, and the net amounts. Confirming creates the charges and the matching adjustments in one transaction.
// Learners admitted later are billed on admission (in full or by the weeks left); a change from day to boarder adds or reverses the boarding charge.
import type { AdjustmentKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, dayOf, idSchema, loadFinSettings, need, resolveTerm, writableTerm, ymd, type Actor } from '@/lib/finance/common';
import { approvedStructure } from '@/lib/finance/structures';
import { applyCreditIfAllowed } from '@/lib/finance/payments';
import { approveAdjustments, discountOn, termsCovered } from '@/lib/finance/discounts';
import { percentOf, zeroTotals, type Cur, type Totals } from '@/lib/finance/money';

type Line = Prisma.FinFeeItemGetPayload<object>;

export interface PlannedAward { kind: AdjustmentKind; label: string; amountCents: number; ruleId: string | null; createdById: string; decidedById: string; sponsor?: { awardId: string; sponsorId: string; sponsorName: string } }
export interface PlannedCharge { line: Line; amountCents: number; proRated: boolean; awards: PlannedAward[] }
export interface StudentPlan {
  studentId: string; name: string; admissionNumber: string; className: string | null;
  outcome: 'CHARGED' | 'SKIPPED_CHARGED' | 'SKIPPED_INACTIVE';
  charges: PlannedCharge[];
}

const lineLevels = (l: { levelId: string | null; levelIds: string[] }) => (l.levelIds.length ? l.levelIds : l.levelId ? [l.levelId] : []);

/** Does a fee line apply to this learner (form, day/boarder, class, subject combination)? */
export function lineApplies(l: Line, s: { levelId: string; classId: string; boarding: 'DAY' | 'BOARDER'; subjectIds: Set<string> }, combos: Map<string, Set<string>>): boolean {
  const levels = lineLevels(l);
  if (levels.length && !levels.includes(s.levelId)) return false;
  if (l.boarding && l.boarding !== s.boarding) return false;
  if (l.classIds.length && !l.classIds.includes(s.classId)) return false;
  if (l.combinationIds.length && !l.combinationIds.some((cid) => { const need = combos.get(cid); return !!need && need.size > 0 && Array.from(need).every((sub) => s.subjectIds.has(sub)); })) return false;
  return true;
}

export interface PlanOptions { classId?: string; studentIds?: string[]; prorate?: { from: Date } | null; only?: 'BOARDER_LINES' }

/** Works out, for the learners asked about, what billing would charge and which awards come off. Reads only; the caller decides what to write. */
export async function planBilling(tx: Db, schoolId: string, term: { id: string; startDate: Date; endDate: Date }, lines: Line[], opts: PlanOptions = {}) {
  const lineIds = lines.map((l) => l.id);
  const enrolments = await tx.enrollment.findMany({
    where: { schoolId, termId: term.id, ...(opts.classId ? { classId: opts.classId } : {}), ...(opts.studentIds ? { studentId: { in: opts.studentIds } } : {}) },
    select: { studentId: true, status: true, classId: true, class: { select: { name: true, levelId: true } }, student: { select: { fullName: true, admissionNumber: true, status: true, boarding: true, admissionDate: true } } },
    orderBy: [{ student: { surname: 'asc' } }, { student: { firstName: 'asc' } }],
  });
  const eligible = enrolments.filter((e) => e.status === 'ACTIVE' && e.student.status === 'ACTIVE');
  const ids = eligible.map((e) => e.studentId);

  const [existing, comboRows, subjectRows, rules, terms, awards, settings] = await Promise.all([
    ids.length ? tx.finCharge.findMany({ where: { schoolId, termId: term.id, feeItemId: { in: lineIds }, studentId: { in: ids } }, select: { studentId: true, feeItemId: true } }) : Promise.resolve([]),
    lines.some((l) => l.combinationIds.length) ? tx.subjectCombinationItem.findMany({ where: { schoolId, combinationId: { in: Array.from(new Set(lines.flatMap((l) => l.combinationIds))) } }, select: { combinationId: true, subjectId: true } }) : Promise.resolve([]),
    lines.some((l) => l.combinationIds.length) && ids.length ? tx.studentSubject.findMany({ where: { schoolId, termId: term.id, studentId: { in: ids } }, select: { studentId: true, subjectId: true } }) : Promise.resolve([]),
    ids.length ? tx.discountRule.findMany({ where: { schoolId, status: 'APPROVED', studentId: { in: ids } }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
    tx.academicTerm.findMany({ where: { schoolId }, select: { id: true, startDate: true } }),
    ids.length ? tx.sponsorAward.findMany({ where: { schoolId, status: 'APPROVED', studentId: { in: ids } }, include: { sponsor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
    loadFinSettings(tx, schoolId),
  ]);
  const done = new Set(existing.map((e) => `${e.studentId}|${e.feeItemId}`));
  const combos = new Map<string, Set<string>>();
  for (const c of comboRows) (combos.get(c.combinationId) ?? combos.set(c.combinationId, new Set()).get(c.combinationId)!).add(c.subjectId);
  const subjects = new Map<string, Set<string>>();
  for (const r of subjectRows) (subjects.get(r.studentId) ?? subjects.set(r.studentId, new Set()).get(r.studentId)!).add(r.subjectId);
  const startOf = new Map(terms.map((t) => [t.id, t.startDate.getTime()]));

  // Which brother or sister is this? Learners with one fee payer in the term, oldest admission first.
  const siblingRank = new Map<string, number>();
  const sibOn = settings.siblingApprovedById && ((settings.siblingPct2Bps ?? 0) > 0 || (settings.siblingPct3Bps ?? 0) > 0);
  if (sibOn && ids.length) {
    const links = await tx.studentGuardian.findMany({ where: { isFeePayer: true, studentId: { in: ids } }, select: { guardianId: true } });
    const gids = Array.from(new Set(links.map((l) => l.guardianId)));
    if (gids.length) {
      const kids = await tx.studentGuardian.findMany({
        where: { guardianId: { in: gids }, isFeePayer: true, student: { schoolId, status: 'ACTIVE', enrollments: { some: { termId: term.id, status: 'ACTIVE' } } } },
        select: { guardianId: true, student: { select: { id: true, admissionDate: true, admissionNumber: true } } },
      });
      const byG = new Map<string, typeof kids>();
      for (const k of kids) (byG.get(k.guardianId) ?? byG.set(k.guardianId, []).get(k.guardianId)!).push(k);
      for (const group of Array.from(byG.values())) {
        group.sort((a, b) => a.student.admissionDate.getTime() - b.student.admissionDate.getTime() || a.student.admissionNumber.localeCompare(b.student.admissionNumber));
        group.forEach((k, i) => siblingRank.set(k.student.id, Math.max(siblingRank.get(k.student.id) ?? 0, i + 1)));
      }
    }
  }
  const sibItems = new Set(settings.siblingItemIds);

  const totalDays = Math.max(1, Math.round((term.endDate.getTime() - term.startDate.getTime()) / 86_400_000) + 1);
  const weeksTotal = Math.ceil(totalDays / 7);
  const factorFrom = (from: Date) => {
    const start = from > term.startDate ? from : term.startDate;
    const daysLeft = Math.max(1, Math.round((term.endDate.getTime() - start.getTime()) / 86_400_000) + 1);
    return Math.min(1, Math.ceil(daysLeft / 7) / weeksTotal);
  };
  const itemRecurring = new Map((await tx.feeItem.findMany({ where: { schoolId }, select: { id: true, recurring: true } })).map((i) => [i.id, i.recurring]));

  const plans: StudentPlan[] = [];
  for (const e of enrolments) {
    const base = { studentId: e.studentId, name: e.student.fullName, admissionNumber: e.student.admissionNumber, className: e.class.name };
    if (!(e.status === 'ACTIVE' && e.student.status === 'ACTIVE')) { plans.push({ ...base, outcome: 'SKIPPED_INACTIVE', charges: [] }); continue; }
    const ctx = { levelId: e.class.levelId, classId: e.classId, boarding: e.student.boarding as 'DAY' | 'BOARDER', subjectIds: subjects.get(e.studentId) ?? new Set<string>() };
    const mine = lines.filter((l) => lineApplies(l, ctx, combos) && (opts.only !== 'BOARDER_LINES' || l.boarding === 'BOARDER'));
    const fresh = mine.filter((l) => !done.has(`${e.studentId}|${l.id}`));
    if (fresh.length === 0) { plans.push({ ...base, outcome: 'SKIPPED_CHARGED', charges: [] }); continue; }

    const myRules = rules.filter((r) => r.studentId === e.studentId && (() => {
      const from = startOf.get(r.termFromId); const to = r.termToId ? startOf.get(r.termToId) : undefined; const t = term.startDate.getTime();
      return from !== undefined && t >= from && (to !== undefined ? t <= to : r.standing ? true : t <= from);
    })());
    const myAwards = awards.filter((a) => {
      const from = startOf.get(a.termFromId); const to = a.termToId ? startOf.get(a.termToId) : undefined; const t = term.startDate.getTime();
      return from !== undefined && t >= from && (to === undefined || t <= to);
    });
    const fixedLeft = new Map(myRules.filter((r) => r.percentBps === null).map((r) => [r.id, r.amountCents ?? 0]));
    const awardLeft = new Map(myAwards.filter((a) => a.amountCents !== null).map((a) => [a.id, a.amountCents ?? 0]));

    const charges: PlannedCharge[] = [];
    for (const line of fresh) {
      const prorate = opts.prorate && (itemRecurring.get(line.catalogItemId ?? '') ?? true);
      const amount = prorate ? Math.max(1, Math.round(line.amountCents * factorFrom(opts.prorate!.from))) : line.amountCents;
      let room = amount;
      const awardsFor: PlannedAward[] = [];
      for (const r of myRules) {
        if (r.currency && r.currency !== line.currency) continue;
        if (r.catalogItemIds.length && !r.catalogItemIds.includes(line.catalogItemId ?? '')) continue;
        const want = r.percentBps !== null ? discountOn(r, amount, room) : Math.min(fixedLeft.get(r.id) ?? 0, room);
        if (want <= 0) continue;
        if (r.percentBps === null) fixedLeft.set(r.id, (fixedLeft.get(r.id) ?? 0) - want);
        room -= want;
        awardsFor.push({ kind: r.kind, label: r.reason, amountCents: want, ruleId: r.id, createdById: r.createdById, decidedById: r.decidedById! });
      }
      const rank = siblingRank.get(e.studentId) ?? 1;
      const bps = rank >= 3 ? (settings.siblingPct3Bps ?? 0) : rank === 2 ? (settings.siblingPct2Bps ?? 0) : 0;
      const sibItem = sibItems.size ? sibItems.has(line.catalogItemId ?? '') : (await fundKind(tx, line.fundId)) === 'TUITION';
      if (sibOn && bps > 0 && sibItem && settings.siblingSetById && settings.siblingApprovedById) {
        const want = Math.min(percentOf(amount, bps), room);
        if (want > 0) { room -= want; awardsFor.push({ kind: 'SIBLING', label: `Sibling discount (child ${rank})`, amountCents: want, ruleId: null, createdById: settings.siblingSetById, decidedById: settings.siblingApprovedById }); }
      }
      for (const a of myAwards) {
        if (a.currency !== line.currency) continue;
        if (a.catalogItemIds.length && !a.catalogItemIds.includes(line.catalogItemId ?? '')) continue;
        const want = a.percentBps !== null ? Math.min(percentOf(room, a.percentBps), room) : Math.min(awardLeft.get(a.id) ?? 0, room);
        if (want <= 0) continue;
        if (a.percentBps === null) awardLeft.set(a.id, (awardLeft.get(a.id) ?? 0) - want);
        room -= want;
        awardsFor.push({ kind: 'SPONSOR', label: `Covered by ${a.sponsor.name}${a.reference ? ` (${a.reference})` : ''}`, amountCents: want, ruleId: null, createdById: a.createdById, decidedById: a.approvedById!, sponsor: { awardId: a.id, sponsorId: a.sponsorId, sponsorName: a.sponsor.name } });
      }
      charges.push({ line, amountCents: amount, proRated: !!prorate && amount !== line.amountCents, awards: awardsFor });
    }
    plans.push({ ...base, outcome: 'CHARGED', charges });
  }
  return plans;
}

const kindCache = new Map<string, string>();
async function fundKind(tx: Db, fundId: string): Promise<string> {
  if (!kindCache.has(fundId)) kindCache.set(fundId, (await tx.fund.findUnique({ where: { id: fundId }, select: { kind: true } }))?.kind ?? 'OTHER');
  return kindCache.get(fundId)!;
}

export interface FundTotals { fundId: string; fundName: string; currency: Cur; charged: number; discounts: number; sponsors: number; net: number }

function summarise(plans: StudentPlan[], fundName: Map<string, string>) {
  const rows = new Map<string, FundTotals>();
  const slot = (fundId: string, currency: Cur) => {
    const k = `${fundId}|${currency}`;
    let r = rows.get(k);
    if (!r) rows.set(k, (r = { fundId, fundName: fundName.get(fundId) ?? '', currency, charged: 0, discounts: 0, sponsors: 0, net: 0 }));
    return r;
  };
  for (const p of plans) for (const c of p.charges) {
    const r = slot(c.line.fundId, c.line.currency);
    r.charged += c.amountCents;
    for (const a of c.awards) { if (a.kind === 'SPONSOR') r.sponsors += a.amountCents; else r.discounts += a.amountCents; }
  }
  for (const r of Array.from(rows.values())) r.net = r.charged - r.discounts - r.sponsors;
  return Array.from(rows.values()).sort((a, b) => a.fundName.localeCompare(b.fundName) || a.currency.localeCompare(b.currency));
}

export const BillingSchema = z.object({ termId: idSchema.optional(), structureId: idSchema.optional(), classId: idSchema.optional() });

export interface PreviewRow {
  studentId: string; name: string; admissionNumber: string; className: string | null; outcome: StudentPlan['outcome'];
  lines: { name: string; fundName: string; currency: Cur; amountCents: number }[];
  awards: { label: string; currency: Cur; amountCents: number; sponsor: boolean }[];
  net: Totals;
}

async function context(tx: Db, user: Actor, input: z.infer<typeof BillingSchema>, write: boolean) {
  const term = write ? await writableTerm(tx, user.schoolId, input.termId) : await resolveTerm(tx, user.schoolId, input.termId);
  const structure = input.structureId
    ? await tx.finFeeStructure.findFirst({ where: { id: input.structureId, schoolId: user.schoolId, termId: term.id }, include: { lines: { where: { active: true } } } })
    : await approvedStructure(tx, user.schoolId, term.id);
  if (!structure) throw new ServiceError(`${term.name} has no approved fee structure. The bursar prepares it and the Head approves it before anyone can be billed.`, 409);
  if (structure.status !== 'APPROVED') throw new ServiceError('Only an approved fee structure can be billed', 409);
  if (structure.lines.length === 0) throw new ServiceError('The fee structure has no lines', 409);
  const funds = new Map((await tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));
  return { term, structure, funds };
}

/** What billing would do, without doing it. */
export async function previewBilling(user: Actor, raw: unknown) {
  need(user, 'finance.billing.run');
  const input = BillingSchema.parse(raw ?? {});
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { term, structure, funds } = await context(tx, user, input, false);
    const plans = await planBilling(tx, user.schoolId, term, structure.lines, { classId: input.classId });
    const rows: PreviewRow[] = plans.map((p) => {
      const net = zeroTotals();
      for (const c of p.charges) net[c.line.currency] += c.amountCents - c.awards.reduce((s, a) => s + a.amountCents, 0);
      return {
        studentId: p.studentId, name: p.name, admissionNumber: p.admissionNumber, className: p.className, outcome: p.outcome,
        lines: p.charges.map((c) => ({ name: c.line.name, fundName: funds.get(c.line.fundId) ?? '', currency: c.line.currency, amountCents: c.amountCents })),
        awards: p.charges.flatMap((c) => c.awards.map((a) => ({ label: a.label, currency: c.line.currency, amountCents: a.amountCents, sponsor: a.kind === 'SPONSOR' }))), net,
      };
    });
    return {
      term: { id: term.id, name: term.name }, structure: { id: structure.id, version: structure.version },
      counts: { charged: plans.filter((p) => p.outcome === 'CHARGED').length, skippedCharged: plans.filter((p) => p.outcome === 'SKIPPED_CHARGED').length, skippedInactive: plans.filter((p) => p.outcome === 'SKIPPED_INACTIVE').length },
      totals: summarise(plans, funds), rows: rows.slice(0, 1500), truncated: rows.length > 1500,
    };
  });
}

interface Created { chargeId: string; plan: StudentPlan; charge: PlannedCharge }

/** Writes the charges of a plan and the adjustments and sponsor claims that go with them. Returns the charges made. */
async function writePlan(tx: Db, user: Actor, term: { id: string }, plans: StudentPlan[], meta: { billingRunId?: string; source: 'FEE_ITEM' | 'ADMISSION' | 'BOARDING_CHANGE' | 'DIFFERENCE'; dueDate?: Date | null }) {
  const todo: { plan: StudentPlan; charge: PlannedCharge }[] = plans.flatMap((p) => p.charges.map((charge) => ({ plan: p, charge })));
  if (todo.length === 0) return [] as Created[];
  const made = await tx.finCharge.createManyAndReturn({
    data: todo.map((t) => ({
      schoolId: user.schoolId, studentId: t.plan.studentId, termId: term.id, fundId: t.charge.line.fundId, feeItemId: t.charge.line.id, catalogItemId: t.charge.line.catalogItemId, description: t.charge.line.name + (t.charge.proRated ? ' (pro-rated)' : ''),
      currency: t.charge.line.currency, amountCents: t.charge.amountCents, source: meta.source === 'FEE_ITEM' && t.charge.proRated ? 'ADMISSION' : meta.source, dueDate: meta.dueDate ?? null, billingRunId: meta.billingRunId ?? null, createdById: user.id,
    })),
    skipDuplicates: true,
  });
  const idOf = new Map(made.map((c) => [`${c.studentId}|${c.feeItemId}`, c.id]));
  const created: Created[] = [];
  const adj: { chargeId: string; a: PlannedAward; t: { plan: StudentPlan; charge: PlannedCharge } }[] = [];
  for (const t of todo) {
    const chargeId = idOf.get(`${t.plan.studentId}|${t.charge.line.id}`);
    if (!chargeId) continue; // a concurrent run charged it first
    created.push({ chargeId, plan: t.plan, charge: t.charge });
    for (const a of t.charge.awards) adj.push({ chargeId, a, t });
  }
  if (adj.length) {
    const rows = await tx.finAdjustment.createManyAndReturn({
      data: adj.map((x) => ({ schoolId: user.schoolId, chargeId: x.chargeId, kind: x.a.kind, amountCents: x.a.amountCents, ruleId: x.a.ruleId, reason: x.a.label.length >= 5 ? x.a.label : `${x.a.label} discount`, createdById: x.a.createdById })),
    });
    const byDecider = new Map<string, { id: string }[]>();
    rows.forEach((r, i) => { const d = adj[i]!.a.decidedById; (byDecider.get(d) ?? byDecider.set(d, []).get(d)!).push({ id: r.id }); });
    for (const [decider, list] of Array.from(byDecider.entries())) await approveAdjustments(tx, user.schoolId, list, decider, 'Applied at billing');
    const sponsored = adj.map((x, i) => ({ x, id: rows[i]!.id })).filter((e) => e.x.a.sponsor);
    if (sponsored.length) {
      await tx.sponsorCharge.createMany({
        data: sponsored.map((e) => ({
          schoolId: user.schoolId, sponsorId: e.x.a.sponsor!.sponsorId, awardId: e.x.a.sponsor!.awardId, studentId: e.x.t.plan.studentId, chargeId: e.x.chargeId, adjustmentId: e.id, termId: term.id,
          fundId: e.x.t.charge.line.fundId, currency: e.x.t.charge.line.currency, amountCents: e.x.a.amountCents,
        })),
        skipDuplicates: true,
      });
    }
  }
  return created;
}

/** Charges every eligible learner the term's approved fee structure. Running it again charges nobody twice. */
export async function runBilling(user: Actor, raw: unknown) {
  need(user, 'finance.billing.run');
  const input = BillingSchema.parse(raw ?? {});
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { term, structure, funds } = await context(tx, user, input, true);
    const plans = await planBilling(tx, user.schoolId, term, structure.lines, { classId: input.classId });
    const counts = { charged: plans.filter((p) => p.outcome === 'CHARGED').length, skippedCharged: plans.filter((p) => p.outcome === 'SKIPPED_CHARGED').length, skippedInactive: plans.filter((p) => p.outcome === 'SKIPPED_INACTIVE').length };
    const totals = summarise(plans, funds);
    const result = plans.map((p) => {
      const net = zeroTotals();
      for (const c of p.charges) net[c.line.currency] += c.amountCents - c.awards.reduce((s, a) => s + a.amountCents, 0);
      return { studentId: p.studentId, name: p.name, admissionNumber: p.admissionNumber, className: p.className, outcome: p.outcome, charges: p.charges.length, net };
    });
    const run = await tx.billingRun.create({
      data: { schoolId: user.schoolId, termId: term.id, structureId: structure.id, runById: user.id, charged: counts.charged, skippedCharged: counts.skippedCharged, skippedInactive: counts.skippedInactive, awardsCents: totals as never, result: result as never },
    });
    const created = await writePlan(tx, user, term, plans, { billingRunId: run.id, source: 'FEE_ITEM', dueDate: term.startDate });
    await tx.finFeeStructure.updateMany({ where: { id: structure.id, billedAt: null }, data: { billedAt: new Date() } });
    let credit = 0;
    for (const sid of Array.from(new Set(created.map((c) => c.plan.studentId)))) credit += (await applyCreditIfAllowed(tx, user, sid)).reduce((s, a) => s + a.amountCents, 0);
    await audit(tx, user, 'RUN_BILLING', 'BillingRun', run.id, `Billed ${term.name} with fee structure version ${structure.version}: ${created.length} charge(s) to ${counts.charged} learner(s)`, undefined, {
      termId: term.id, structureId: structure.id, ...counts, charges: created.length, totals: JSON.parse(JSON.stringify(totals)), creditAppliedCents: credit,
    });
    return { runId: run.id, ...counts, charges: created.length, totals };
  });
}

/** The result list of a billing run, for download. */
export async function billingRunResult(user: Actor, id: string) {
  need(user, 'finance.billing.run', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.billingRun.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Billing run not found', 404);
    const term = await tx.academicTerm.findFirst({ where: { id: r.termId, schoolId: user.schoolId }, select: { name: true } });
    return { id: r.id, term: term?.name ?? '', at: r.createdAt.toISOString(), charged: r.charged, skippedCharged: r.skippedCharged, skippedInactive: r.skippedInactive, rows: (r.result ?? []) as { studentId: string; name: string; admissionNumber: string; className: string | null; outcome: string; charges: number; net: Totals }[] };
  });
}

export async function listBillingRuns(user: Actor, termId?: string) {
  need(user, 'finance.billing.run', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.billingRun.findMany({ where: { schoolId: user.schoolId, ...(termId ? { termId } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, termId: r.termId, at: r.createdAt.toISOString(), charged: r.charged, skippedCharged: r.skippedCharged, skippedInactive: r.skippedInactive }));
  });
}

// ─── A learner admitted after billing; a change from day to boarder ───────────

/** Bills a newly admitted learner the term's approved structure, in full or by the weeks left (a school setting). Does nothing when the term has not been billed. */
export async function billOnAdmission(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, studentId: string, admittedOn: Date) {
  const settings = await loadFinSettings(tx, user.schoolId);
  if (!settings.autoBillOnAdmission) return null;
  const term = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
  if (!term) return null;
  const structure = await approvedStructure(tx, user.schoolId, term.id);
  if (!structure?.billedAt) return null; // the first billing run will pick the learner up
  const plans = await planBilling(tx, user.schoolId, term, structure.lines, { studentIds: [studentId], prorate: settings.prorateAdmission ? { from: admittedOn } : null });
  const charged = plans.filter((p) => p.outcome === 'CHARGED');
  if (charged.length === 0) return null;
  const created = await writePlan(tx, user as Actor, term, charged, { source: 'FEE_ITEM', dueDate: term.startDate });
  await applyCreditIfAllowed(tx, user, studentId);
  await audit(tx, user, 'RUN_BILLING', 'Student', studentId, `Billed a new learner for ${term.name}${settings.prorateAdmission ? ' by the weeks left' : ''}`, undefined, { termId: term.id, charges: created.length, proRated: settings.prorateAdmission });
  return { charges: created.length };
}

/**
 * Day to boarder: the boarders-only lines are charged from the change date. Boarder to day: the boarders-only charges are reversed from the change
 * date with credit notes that the Head approves (a pending credit note changes nothing until then).
 */
export async function adjustForBoardingChange(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, studentId: string, to: 'DAY' | 'BOARDER', changeDate: Date) {
  const settings = await loadFinSettings(tx, user.schoolId);
  const term = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
  if (!term) return null;
  const structure = await approvedStructure(tx, user.schoolId, term.id);
  if (!structure?.billedAt) return null;
  const boarderLines = structure.lines.filter((l) => l.boarding === 'BOARDER');
  if (boarderLines.length === 0) return null;
  const totalDays = Math.max(1, Math.round((term.endDate.getTime() - term.startDate.getTime()) / 86_400_000) + 1);
  const start = changeDate > term.startDate ? changeDate : term.startDate;
  const daysLeft = Math.max(1, Math.round((term.endDate.getTime() - start.getTime()) / 86_400_000) + 1);
  const factor = Math.min(1, Math.ceil(daysLeft / 7) / Math.ceil(totalDays / 7));
  if (to === 'BOARDER') {
    const plans = await planBilling(tx, user.schoolId, term, boarderLines, { studentIds: [studentId], prorate: settings.prorateAdmission ? { from: changeDate } : null, only: 'BOARDER_LINES' });
    const charged = plans.filter((p) => p.outcome === 'CHARGED');
    if (charged.length === 0) return null;
    const created = await writePlan(tx, user as Actor, term, charged, { source: 'BOARDING_CHANGE', dueDate: changeDate });
    await applyCreditIfAllowed(tx, user, studentId);
    await audit(tx, user, 'RUN_BILLING', 'Student', studentId, 'Added the boarding charge after a change to boarder', undefined, { termId: term.id, charges: created.length });
    return { added: created.length, reversed: 0 };
  }
  const charges = await tx.finCharge.findMany({
    where: { schoolId: user.schoolId, studentId, termId: term.id, voidRow: null, feeItemId: { in: boarderLines.map((l) => l.id) } },
    include: { adjustments: { where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { amountCents: true } } },
  });
  let reversed = 0;
  for (const c of charges) {
    const room = c.amountCents - c.adjustments.reduce((s, a) => s + a.amountCents, 0);
    const credit = Math.min(room, settings.prorateAdmission ? Math.round(c.amountCents * (1 - factor)) : c.amountCents);
    if (credit <= 0) continue;
    await tx.finAdjustment.create({ data: { schoolId: user.schoolId, chargeId: c.id, kind: 'CORRECTION', amountCents: credit, reason: `Changed from boarder to day scholar on ${ymd(changeDate)}`, createdById: user.id } });
    reversed++;
  }
  if (reversed) await audit(tx, user, 'RUN_BILLING', 'Student', studentId, 'Asked to reverse the boarding charge after a change to day scholar', undefined, { termId: term.id, creditNotes: reversed });
  return { added: 0, reversed };
}

// ─── A new fee version: bill the difference ──────────────────────────────────

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * After the Head approves a new version of a structure that was already billed: for every learner charged under the old version, a higher fee
 * is billed as an extra charge and a lower fee as a credit note awaiting approval; lines that are new are billed in full.
 */
export async function billDifference(user: Actor, structureId: string) {
  need(user, 'finance.billing.run');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const next = await tx.finFeeStructure.findFirst({ where: { id: structureId, schoolId: user.schoolId }, include: { lines: { where: { active: true } } } });
    if (!next) throw new ServiceError('Fee structure not found', 404);
    if (next.status !== 'APPROVED') throw new ServiceError('Only the approved version can be billed', 409);
    if (next.billedAt) throw new ServiceError('This version has been billed already', 409);
    const prev = await tx.finFeeStructure.findFirst({ where: { schoolId: user.schoolId, termId: next.termId, version: { lt: next.version }, billedAt: { not: null } }, orderBy: { version: 'desc' }, include: { lines: true } });
    if (!prev) throw new ServiceError('No earlier version of this term was billed, so run term billing instead', 409);
    const term = await writableTerm(tx, user.schoolId, next.termId);

    let higher = 0; let lower = 0;
    const brandNew: typeof next.lines = [];
    for (const nl of next.lines) {
      const old = prev.lines.find((o) => o.catalogItemId === nl.catalogItemId && o.currency === nl.currency && (o.boarding ?? null) === (nl.boarding ?? null)
        && sameSet(lineLevels(o), lineLevels(nl)) && sameSet(o.classIds, nl.classIds) && sameSet(o.combinationIds, nl.combinationIds));
      if (!old) { brandNew.push(nl); continue; }
      if (old.amountCents === nl.amountCents) continue;
      const charges = await tx.finCharge.findMany({ where: { schoolId: user.schoolId, termId: term.id, feeItemId: old.id, voidRow: null }, include: { adjustments: { where: { status: { in: ['PENDING', 'APPROVED'] } }, select: { amountCents: true } } } });
      const diff = nl.amountCents - old.amountCents;
      if (diff > 0) {
        await tx.finCharge.createMany({
          data: charges.map((c) => ({ schoolId: user.schoolId, studentId: c.studentId, termId: term.id, fundId: nl.fundId, feeItemId: nl.id, catalogItemId: nl.catalogItemId, description: `${nl.name} (revised fees)`, currency: nl.currency, amountCents: diff, source: 'DIFFERENCE' as const, dueDate: new Date(), createdById: user.id })),
          skipDuplicates: true,
        });
        higher += charges.length;
      } else {
        for (const c of charges) {
          const room = c.amountCents - c.adjustments.reduce((s, a) => s + a.amountCents, 0);
          const credit = Math.min(-diff, room);
          if (credit <= 0) continue;
          await tx.finAdjustment.create({ data: { schoolId: user.schoolId, chargeId: c.id, kind: 'CORRECTION', amountCents: credit, reason: `Fees revised from ${(old.amountCents / 100).toFixed(2)} to ${(nl.amountCents / 100).toFixed(2)}`, createdById: user.id } });
          lower++;
        }
      }
    }
    let added = 0;
    if (brandNew.length) {
      const plans = await planBilling(tx, user.schoolId, term, brandNew);
      added = (await writePlan(tx, user, term, plans.filter((p) => p.outcome === 'CHARGED'), { source: 'DIFFERENCE', dueDate: new Date() })).length;
    }
    await tx.finFeeStructure.updateMany({ where: { id: next.id, billedAt: null }, data: { billedAt: new Date() } });
    await audit(tx, user, 'BILL_DIFFERENCE', 'FinFeeStructure', next.id, `Billed the difference between versions ${prev.version} and ${next.version}`, { version: prev.version }, { version: next.version, extraCharges: higher, creditNotesAskedFor: lower, newLineCharges: added });
    return { extraCharges: higher, creditNotes: lower, newLineCharges: added };
  });
}

export { dayOf };
