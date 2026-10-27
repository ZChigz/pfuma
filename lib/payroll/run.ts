// The monthly payroll run. HR prepares and submits it; the Owner approves it (never the person who prepared it); Finance pays it
// through the payout hand-over (never the person who prepared it either). After submission the run is locked and its lines are a
// snapshot: a mistake is corrected in next month's run with an adjustment line and a reason, or the Owner reopens the run before
// it is paid. Only school-paid staff are ever in a run. Each currency is calculated and totalled on its own.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Employee, EmployeePay, HrPayrollLine, HrPayrollRun, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  audit, centsSchema, currencySchema, daysBetween, fullName, hrHolds, idSchema, isoOf, loadHrSettings, monthRange, monthSchema, need, optText, tellHolders,
  toDay, type Actor,
} from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { workCalendar } from '@/lib/hr/calendar';
import { calcPay, casualPay, netMovedFlag, prorate, splitPay, unpaidLeaveDeduction, type Cur, type DeductionLine, type EarningLine, type PayResult } from '@/lib/payroll/calc';
import { loadSettings, ratesForMonth } from '@/lib/payroll/settings-service';
import { handOverPayroll } from '@/lib/finance/payroll';
import { notifyUsers } from '@/lib/system/notifications';

const CURS: Cur[] = ['USD', 'ZIG'];

export interface LineFlag { code: 'NET_CHANGE' | 'NET_NEGATIVE' | 'NO_HOURS' | 'NO_RATE'; message: string }

interface Draft {
  employeeId: string; currency: Cur; departmentId: string | null; earnings: EarningLine[]; deductions: DeductionLine[]; result: PayResult;
  previousNetCents: number | null; flags: LineFlag[];
}

export type Totals = Record<Cur, { people: number; grossCents: number; taxableCents: number; payeCents: number; aidsLevyCents: number; nssaEmployeeCents: number; nssaEmployerCents: number; zimdefCents: number; otherDeductionsCents: number; netCents: number; costToSchoolCents: number }>;
const zeroTotals = (): Totals['USD'] => ({ people: 0, grossCents: 0, taxableCents: 0, payeCents: 0, aidsLevyCents: 0, nssaEmployeeCents: 0, nssaEmployerCents: 0, zimdefCents: 0, otherDeductionsCents: 0, netCents: 0, costToSchoolCents: 0 });

function addTotals(t: Totals['USD'], r: PayResult) {
  t.people++; t.grossCents += r.grossCents; t.taxableCents += r.taxableCents; t.payeCents += r.payeCents; t.aidsLevyCents += r.aidsLevyCents; t.nssaEmployeeCents += r.nssaEmployeeCents;
  t.nssaEmployerCents += r.nssaEmployerCents; t.zimdefCents += r.zimdefCents; t.otherDeductionsCents += r.otherDeductionsCents; t.netCents += r.netCents; t.costToSchoolCents += r.costToSchoolCents;
}

export function totalsOf(drafts: { currency: Cur; departmentId: string | null; result: PayResult }[]) {
  const total: Totals = { USD: zeroTotals(), ZIG: zeroTotals() };
  const byDepartment: Record<string, Totals> = {};
  for (const d of drafts) {
    addTotals(total[d.currency], d.result);
    const k = d.departmentId ?? 'none';
    byDepartment[k] ??= { USD: zeroTotals(), ZIG: zeroTotals() };
    addTotals(byDepartment[k]![d.currency], d.result);
  }
  return { total, byDepartment };
}

// ─── Calculating ─────────────────────────────────────────────────────────────

async function previousNets(tx: Db, schoolId: string, month: string) {
  const prev = await tx.hrPayrollRun.findFirst({ where: { schoolId, month: { lt: month }, status: { in: ['APPROVED', 'PAID'] } }, orderBy: { month: 'desc' } });
  const map = new Map<string, HrPayrollLine>();
  if (prev) for (const l of await tx.hrPayrollLine.findMany({ where: { schoolId, runId: prev.id } })) map.set(`${l.employeeId}:${l.currency}`, l);
  return { prev, map };
}

const asLines = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function explainChange(prev: HrPayrollLine | undefined, d: Draft, partMonth: boolean, unpaidDays: number): string {
  const reasons: string[] = [];
  if (partMonth) reasons.push('part month');
  if (unpaidDays > 0) reasons.push(`${unpaidDays} unpaid day${unpaidDays === 1 ? '' : 's'}`);
  if (prev) {
    const before = new Set([...asLines<EarningLine>(prev.earnings).map((e) => e.code), ...asLines<DeductionLine>(prev.deductions).map((e) => e.code)]);
    const added = [...d.earnings, ...d.deductions].filter((l) => !before.has(l.code) && !l.code.startsWith('UNPAID'));
    if (added.length) reasons.push(`new: ${added.map((l) => l.label).join(', ')}`);
    const now = new Set([...d.earnings, ...d.deductions].map((e) => e.code));
    const gone = [...asLines<EarningLine>(prev.earnings), ...asLines<DeductionLine>(prev.deductions)].filter((l) => !now.has(l.code));
    if (gone.length) reasons.push(`ended: ${gone.map((l) => l.label).join(', ')}`);
    if (prev.grossCents !== d.result.grossCents && !reasons.length) reasons.push('pay changed');
  }
  return reasons.length ? reasons.join('; ') : 'no single cause found; check the lines';
}

/** Works out every line of a run from the pay set-up, the variables, leave, attendance and loans. Pure reads; returns what to write. */
export async function computeRun(tx: Db, schoolId: string, run: Pick<HrPayrollRun, 'id' | 'month'>): Promise<{ drafts: Draft[]; unpaid: Map<string, number> }> {
  const { first, last, days } = monthRange(run.month);
  const settings = await loadSettings(tx, schoolId);
  const rates = { USD: ratesForMonth(settings, 'USD', run.month), ZIG: ratesForMonth(settings, 'ZIG', run.month) };
  const hr = await loadHrSettings(tx, schoolId);

  const pays = await tx.employeePay.findMany({ where: { schoolId } });
  const payOf = new Map(pays.map((p) => [p.employeeId, p]));
  const employees = (await tx.employee.findMany({
    where: { schoolId, employer: 'SCHOOL', startDate: { lte: toDay(last) }, OR: [{ leavingDate: null }, { leavingDate: { gte: toDay(first) } }] },
    orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
  })).filter((e) => payOf.has(e.id));

  const [comps, defs, loans, vars, leaves, cal, prev, attendance] = await Promise.all([
    tx.employeePayComponent.findMany({ where: { schoolId, startsOn: { lte: toDay(last) }, OR: [{ endsOn: null }, { endsOn: { gte: toDay(first) } }] } }),
    tx.payComponent.findMany({ where: { schoolId } }),
    tx.loan.findMany({ where: { schoolId, status: 'ACTIVE', startMonth: { lte: run.month }, balanceCents: { gt: 0 } } }),
    tx.hrPayrollVariable.findMany({ where: { schoolId, runId: run.id } }),
    tx.leaveRequest.findMany({ where: { schoolId, status: 'APPROVED', startDate: { lte: toDay(last) }, endDate: { gte: toDay(first) } } }),
    workCalendar(tx, schoolId, first, last),
    previousNets(tx, schoolId, run.month),
    tx.staffAttendance.findMany({ where: { schoolId, date: { gte: toDay(first), lte: toDay(last) } } }),
  ]);
  const unpaidTypeIds = new Set((await tx.leaveType.findMany({ where: { schoolId, unpaid: true }, select: { id: true } })).map((t) => t.id));
  const defOf = new Map(defs.map((d) => [d.id, d]));
  const workDays = cal.days(first, last).length;

  const unpaid = new Map<string, number>();
  for (const l of leaves) {
    if (!unpaidTypeIds.has(l.leaveTypeId)) continue;
    const s = isoOf(l.startDate), e = isoOf(l.endDate);
    const inside = s >= first && e <= last;
    const n = inside ? l.days : cal.days(s < first ? first : s, e > last ? last : e).length;
    unpaid.set(l.employeeId, (unpaid.get(l.employeeId) ?? 0) + n);
  }
  for (const v of vars) if (v.kind === 'UNPAID_DAYS') unpaid.set(v.employeeId, (unpaid.get(v.employeeId) ?? 0) + (v.units ?? 0));

  const drafts: Draft[] = [];
  for (const e of employees) {
    const pay = payOf.get(e.id)!;
    const start = isoOf(e.startDate) > first ? isoOf(e.startDate) : first;
    const end = e.leavingDate && isoOf(e.leavingDate) < last ? isoOf(e.leavingDate) : last;
    const worked = Math.max(0, daysBetween(start, end));
    const partMonth = worked < days;
    const earn: Record<Cur, EarningLine[]> = { USD: [], ZIG: [] };
    const ded: Record<Cur, DeductionLine[]> = { USD: [], ZIG: [] };
    const flags: Record<Cur, LineFlag[]> = { USD: [], ZIG: [] };
    const myVars = vars.filter((v) => v.employeeId === e.id);
    const unpaidDays = unpaid.get(e.id) ?? 0;

    // Basic pay per currency.
    let basics: Record<Cur, number> = { USD: 0, ZIG: 0 };
    let basicCur: Cur[] = [];
    if (pay.payBasis === 'MONTHLY') {
      if (pay.splitUsdBps != null) {
        if (!hr.payrollZigPerUsd) throw new ServiceError(`${fullName(e)} is paid by a split rule, so the payroll rate (ZiG per US$1) must be set in Payroll settings first.`, 409);
        const sp = splitPay(pay.splitTotalUsdCents ?? 0, pay.splitUsdBps, hr.payrollZigPerUsd);
        basics = { USD: sp.USD, ZIG: sp.ZIG };
      } else basics = { USD: pay.basicUsdCents, ZIG: pay.basicZigCents };
      basicCur = CURS.filter((c) => basics[c] > 0);
      for (const c of basicCur) {
        let amt = partMonth ? prorate(basics[c], worked, days) : basics[c];
        if (unpaidDays > 0) amt -= Math.min(amt, unpaidLeaveDeduction(amt, Math.min(unpaidDays, Math.max(workDays, 1)), Math.max(workDays, 1)));
        const label = ['Basic', partMonth ? `${worked} of ${days} days` : '', unpaidDays > 0 ? `less ${unpaidDays} unpaid day${unpaidDays === 1 ? '' : 's'}` : ''].filter(Boolean);
        earn[c].push({ code: 'BASIC', label: label.length > 1 ? `${label[0]} (${label.slice(1).join(', ')})` : 'Basic', amountCents: amt, taxable: true });
      }
    } else {
      const cur = pay.rateCurrency as Cur;
      const units = pay.payBasis === 'DAILY'
        ? (myVars.some((v) => v.kind === 'CASUAL_UNITS') ? myVars.filter((v) => v.kind === 'CASUAL_UNITS').reduce((s, v) => s + (v.units ?? 0), 0)
          : attendance.filter((a) => a.employeeId === e.id).reduce((s, a) => s + (a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'OFFICIAL_DUTY' ? 1 : a.status === 'HALF_DAY' ? 0.5 : 0), 0))
        : myVars.filter((v) => v.kind === 'CASUAL_UNITS').reduce((s, v) => s + (v.units ?? 0), 0);
      const amt = casualPay(units, pay.rateCents ?? 0);
      if (amt > 0) earn[cur].push({ code: 'CASUAL', label: `${units} ${pay.payBasis === 'DAILY' ? 'days' : 'hours'} at ${(pay.rateCents ?? 0) / 100}`, amountCents: amt, taxable: true });
      else flags[cur].push({ code: 'NO_HOURS', message: `No ${pay.payBasis === 'DAILY' ? 'days from the register' : 'hours entered'} for this month` });
      basicCur = [cur];
    }

    // Fixed allowances and deductions.
    for (const c of comps.filter((x) => x.employeeId === e.id)) {
      const def = defOf.get(c.componentId);
      if (!def) continue;
      const cur = c.currency as Cur;
      if (def.kind === 'ALLOWANCE') {
        const amt = !def.variable && partMonth ? prorate(c.amountCents, worked, days) : c.amountCents;
        earn[cur].push({ code: def.code, label: def.name, amountCents: amt, taxable: def.taxable });
      } else ded[cur].push({ code: def.code, label: def.name, amountCents: c.amountCents });
    }
    for (const l of loans.filter((x) => x.employeeId === e.id)) {
      ded[l.currency as Cur].push({ code: `LOAN:${l.id}`, label: 'Loan repayment', amountCents: Math.min(l.instalmentCents, l.balanceCents) });
    }
    // One-off items.
    for (const v of myVars) {
      const cur = v.currency as Cur;
      if (v.kind === 'OVERTIME' || v.kind === 'BONUS') earn[cur].push({ code: `${v.kind}:${v.id}`, label: v.label, amountCents: v.amountCents, taxable: v.taxable });
      else if (v.kind === 'DEDUCTION') ded[cur].push({ code: `DEDUCTION:${v.id}`, label: v.label, amountCents: v.amountCents });
      else if (v.kind === 'ADJUSTMENT') {
        if (v.amountCents >= 0) earn[cur].push({ code: `ADJUSTMENT:${v.id}`, label: `Correction: ${v.label}`, amountCents: v.amountCents, taxable: v.taxable });
        else ded[cur].push({ code: `ADJUSTMENT:${v.id}`, label: `Correction: ${v.label}`, amountCents: -v.amountCents });
      }
    }

    for (const c of CURS) {
      if (earn[c].length === 0 && ded[c].length === 0 && !(c === basicCur[0] && flags[c].length)) continue;
      const result = calcPay({ currency: c, earnings: earn[c], deductions: ded[c] }, rates[c]);
      const prevLine = prev.map.get(`${e.id}:${c}`);
      const mv = netMovedFlag(prevLine?.netCents ?? null, result.netCents, hr.netChangeFlagPct);
      const f = [...flags[c]];
      if (result.netCents < 0) f.push({ code: 'NET_NEGATIVE', message: 'Deductions are more than the pay. Reduce a deduction or loan instalment.' });
      const draft: Draft = { employeeId: e.id, currency: c, departmentId: e.departmentId, earnings: earn[c], deductions: ded[c], result, previousNetCents: prevLine?.netCents ?? null, flags: f };
      if (mv.flagged) f.push({ code: 'NET_CHANGE', message: `Net pay moved ${mv.changePct == null ? 'from nothing' : `${mv.changePct > 0 ? '+' : ''}${mv.changePct}%`} since last month: ${explainChange(prevLine, draft, partMonth, unpaidDays)}` });
      drafts.push(draft);
    }
  }
  return { drafts, unpaid };
}

async function writeLines(tx: Db, schoolId: string, run: HrPayrollRun, drafts: Draft[]) {
  await tx.hrPayrollLine.deleteMany({ where: { schoolId, runId: run.id } });
  if (drafts.length) {
    await tx.hrPayrollLine.createMany({
      data: drafts.map((d) => ({
        schoolId, runId: run.id, employeeId: d.employeeId, currency: d.currency, departmentId: d.departmentId, earnings: d.earnings as unknown as Prisma.InputJsonValue, deductions: d.deductions as unknown as Prisma.InputJsonValue,
        grossCents: d.result.grossCents, taxableCents: d.result.taxableCents, payeCents: d.result.payeCents, aidsLevyCents: d.result.aidsLevyCents, nssaEmployeeCents: d.result.nssaEmployeeCents,
        nssaEmployerCents: d.result.nssaEmployerCents, zimdefCents: d.result.zimdefCents, netCents: d.result.netCents, previousNetCents: d.previousNetCents,
        flags: d.flags.length ? (d.flags as unknown as Prisma.InputJsonValue) : undefined,
      })),
    });
  }
  const t = totalsOf(drafts);
  await tx.hrPayrollRun.update({ where: { id: run.id }, data: { totals: { ...t, calculatedAt: new Date().toISOString(), people: new Set(drafts.map((d) => d.employeeId)).size } as unknown as Prisma.InputJsonValue } });
  return t;
}

async function loadRun(tx: Db, schoolId: string, id: string): Promise<HrPayrollRun> {
  const r = await tx.hrPayrollRun.findFirst({ where: { id, schoolId } });
  if (!r) throw new ServiceError('Payroll run not found', 404);
  return r;
}

function assertPreparer(user: Actor, run: HrPayrollRun) {
  if (run.preparedById !== user.id) throw new ServiceError('This run was prepared by someone else. Only the person who prepared it can change or submit it.', 403);
}

function assertOpen(run: HrPayrollRun) {
  if (!['DRAFT', 'RETURNED'].includes(run.status)) throw new ServiceError(`This run is ${run.status.toLowerCase()} and cannot be changed. Correct a mistake in next month's run with an adjustment line, or ask the Owner to reopen it before it is paid.`, 409);
}

// ─── Create, variables, calculate ────────────────────────────────────────────

export const CreateRunSchema = z.object({ month: monthSchema });

/** Starts the run for a month: every active school-paid employee with a pay set-up is included, and the lines are worked out. */
export async function createRun(user: Actor, raw: unknown) {
  need(user, 'hr.payroll.prepare');
  const { month } = CreateRunSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const settings = await loadSettings(tx, user.schoolId);
    ratesForMonth(settings, 'USD', month); ratesForMonth(settings, 'ZIG', month); // throws until the accountant has confirmed them
    if (await tx.hrPayrollRun.findFirst({ where: { schoolId: user.schoolId, month }, select: { id: true } })) throw new ServiceError(`There is already a payroll run for ${month}.`, 409);
    const run = await tx.hrPayrollRun.create({ data: { schoolId: user.schoolId, month, preparedById: user.id } });
    const { drafts } = await computeRun(tx, user.schoolId, run);
    await writeLines(tx, user.schoolId, run, drafts);
    await audit(tx, user, 'HR_CREATE_RUN', 'HrPayrollRun', run.id, `Started the payroll for ${month} with ${new Set(drafts.map((d) => d.employeeId)).size} people`, undefined, { month });
    return { id: run.id, month, lines: drafts.length };
  });
}

export const VariableSchema = z.object({
  employeeId: idSchema, kind: z.enum(['OVERTIME', 'BONUS', 'DEDUCTION', 'UNPAID_DAYS', 'CASUAL_UNITS', 'ADJUSTMENT']), label: z.string().trim().min(2, 'Describe it').max(100),
  amountCents: z.number().int().min(-2_000_000_000).max(2_000_000_000).optional(), currency: currencySchema.default('USD'), units: z.number().positive().max(10_000).optional(),
  // Overtime: hours (units) times this rate.
  rateCents: centsSchema.optional(), taxable: z.boolean().default(true), reason: optText(300),
}).superRefine((v, ctx) => {
  const need = (ok: boolean, path: string, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', path: [path], message }); };
  if (v.kind === 'OVERTIME') need(v.amountCents != null || (v.units != null && v.rateCents != null), 'units', 'Enter the hours and the rate, or the amount');
  if (v.kind === 'BONUS' || v.kind === 'DEDUCTION') need((v.amountCents ?? 0) > 0, 'amountCents', 'Enter an amount above zero');
  if (v.kind === 'UNPAID_DAYS' || v.kind === 'CASUAL_UNITS') need(v.units != null, 'units', 'Enter the number of days or hours');
  if (v.kind === 'ADJUSTMENT') {
    need(!!v.amountCents, 'amountCents', 'Enter the amount of the correction (negative to take money back)');
    need((v.reason ?? '').length >= 5, 'reason', 'A correction needs a reason (at least 5 characters)');
  }
});

export async function addVariable(user: Actor, runId: string, raw: unknown) {
  need(user, 'hr.payroll.prepare');
  const v = VariableSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    assertPreparer(user, run); assertOpen(run);
    const e = await tx.employee.findFirst({ where: { id: v.employeeId, schoolId: user.schoolId } });
    if (!e) throw new ServiceError('Employee not found', 404);
    if (e.employer !== 'SCHOOL') throw new ServiceError('Government-paid staff are never in the school payroll', 409);
    const amount = v.kind === 'OVERTIME' && v.amountCents == null ? Math.round((v.units ?? 0) * (v.rateCents ?? 0)) : (v.amountCents ?? 0);
    const row = await tx.hrPayrollVariable.create({
      data: { schoolId: user.schoolId, runId, employeeId: v.employeeId, kind: v.kind, label: v.label, amountCents: amount, currency: v.currency, units: v.units ?? null, taxable: v.taxable, reason: v.reason ?? null, createdById: user.id },
    });
    await audit(tx, user, 'HR_SAVE_VARIABLE', 'HrPayrollVariable', row.id, `${v.kind.toLowerCase()} for ${fullName(e)} in ${run.month}: ${v.label}`, undefined, { kind: v.kind, amountCents: amount, units: v.units ?? null, reason: v.reason ?? null });
    return { id: row.id, amountCents: amount };
  });
}

export async function removeVariable(user: Actor, runId: string, variableId: string) {
  need(user, 'hr.payroll.prepare');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    assertPreparer(user, run); assertOpen(run);
    const v = await tx.hrPayrollVariable.findFirst({ where: { id: variableId, runId, schoolId: user.schoolId } });
    if (!v) throw new ServiceError('Not found', 404);
    await tx.hrPayrollVariable.delete({ where: { id: variableId } });
    await audit(tx, user, 'HR_SAVE_VARIABLE', 'HrPayrollVariable', variableId, `Removed ${v.kind.toLowerCase()} "${v.label}" from ${run.month}`, { kind: v.kind, amountCents: v.amountCents }, undefined);
    return { id: variableId };
  });
}

export async function recalculateRun(user: Actor, runId: string) {
  need(user, 'hr.payroll.prepare');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    assertPreparer(user, run); assertOpen(run);
    const { drafts } = await computeRun(tx, user.schoolId, run);
    const t = await writeLines(tx, user.schoolId, run, drafts);
    await audit(tx, user, 'HR_CALCULATE_RUN', 'HrPayrollRun', run.id, `Recalculated the payroll for ${run.month}`, undefined, { net: { USD: t.total.USD.netCents, ZIG: t.total.ZIG.netCents } });
    return { lines: drafts.length };
  });
}

// ─── Workflow ────────────────────────────────────────────────────────────────

/** Submits for approval. The run is calculated afresh first, then locked. A negative net pay stops it. */
export async function submitRun(user: Actor, runId: string) {
  need(user, 'hr.payroll.prepare');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    assertPreparer(user, run); assertOpen(run);
    const { drafts } = await computeRun(tx, user.schoolId, run);
    if (drafts.length === 0) throw new ServiceError('There is nobody to pay in this run. Set up pay for the school-paid staff first.', 409);
    const negative = drafts.filter((d) => d.result.netCents < 0);
    if (negative.length) throw new ServiceError(`${negative.length} ${negative.length === 1 ? 'person has' : 'people have'} negative net pay. Fix their deductions before submitting.`, 409);
    await writeLines(tx, user.schoolId, run, drafts);
    await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), returnComment: null } });
    await audit(tx, user, 'HR_SUBMIT_RUN', 'HrPayrollRun', run.id, `Submitted the payroll for ${run.month} for approval`, { status: run.status }, { status: 'SUBMITTED' });
    await tellHolders(tx, user, 'hr.payroll.approve', { title: `Payroll for ${run.month} waits for your approval`, link: `/hr/payroll/${run.id}` });
    return { id: run.id, status: 'SUBMITTED' as const };
  });
}

const dueDate = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const PAY_METHOD = { BANK: 'BANK_TRANSFER', ECOCASH: 'ECOCASH', CASH: 'CASH' } as const;

/**
 * The Owner approves: the run is locked for good, and its lines and the statutory amounts are handed to Finance, which pays them
 * (someone other than the preparer). The preparer cannot approve their own run, not even if they are the Owner.
 */
export async function approveRun(user: Actor, runId: string) {
  need(user, 'hr.payroll.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    if (run.status !== 'SUBMITTED') throw new ServiceError(`This run is ${run.status.toLowerCase()}; only a submitted run can be approved.`, 409);
    if (run.preparedById === user.id) throw new ServiceError('You prepared this payroll, so someone else must approve it.', 403);
    const lines = await tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, runId } });
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: lines.map((l) => l.employeeId) } } });
    const pays = await tx.employeePay.findMany({ where: { schoolId: user.schoolId, employeeId: { in: emps.map((e) => e.id) } } });
    const eOf = new Map(emps.map((e) => [e.id, e])), pOf = new Map(pays.map((p) => [p.employeeId, p]));
    const hr = await loadHrSettings(tx, user.schoolId);

    const payable = lines.filter((l) => l.netCents > 0);
    if (payable.length === 0) throw new ServiceError('Nothing is payable in this run.', 409);
    const finLines = payable.map((l) => {
      const e = eOf.get(l.employeeId)!, p = pOf.get(l.employeeId) as EmployeePay;
      return {
        employee: fullName(e), employeeRef: e.employeeNo, currency: l.currency, netCents: l.netCents, method: PAY_METHOD[p.paymentMethod],
        account: p.paymentMethod === 'BANK' ? [p.bankName, p.accountNumber].filter(Boolean).join(' ') : p.paymentMethod === 'ECOCASH' ? (p.ecocashNumber ?? undefined) : undefined,
      };
    });
    const statutory: { type: 'PAYE' | 'AIDS_LEVY' | 'NSSA' | 'ZIMDEF'; currency: Cur; amountCents: number; dueDate: string }[] = [];
    for (const c of CURS) {
      const ls = lines.filter((l) => l.currency === c);
      const sum = (f: (l: HrPayrollLine) => number) => ls.reduce((s, l) => s + f(l), 0);
      const add = (type: 'PAYE' | 'AIDS_LEVY' | 'NSSA' | 'ZIMDEF', amountCents: number, day: number) => { if (amountCents > 0) statutory.push({ type, currency: c, amountCents, dueDate: dueDate(run.month, day) }); };
      add('PAYE', sum((l) => l.payeCents), hr.payeDueDay);
      add('AIDS_LEVY', sum((l) => l.aidsLevyCents), hr.payeDueDay);
      add('NSSA', sum((l) => l.nssaEmployeeCents + l.nssaEmployerCents), hr.nssaDueDay);
      add('ZIMDEF', sum((l) => l.zimdefCents), hr.zimdefDueDay);
    }
    const fin = await handOverPayroll(tx, user.schoolId, { period: run.month, preparedById: run.preparedById, approvedById: user.id, hrRunId: run.id, lines: finLines, statutory });
    await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date(), financeRunId: fin.id } });
    await audit(tx, user, 'HR_APPROVE_RUN', 'HrPayrollRun', runId, `Approved the payroll for ${run.month}; handed to Finance`, { status: 'SUBMITTED' }, { status: 'APPROVED', financeRunId: fin.id, payable: payable.length });
    await tellHolders(tx, user, 'finance.payroll.pay', { title: `Payroll for ${run.month} is ready to pay`, link: '/finance/payroll' });
    await notifyUsers(tx, user.schoolId, [run.preparedById], { type: 'HR', title: `Payroll for ${run.month} was approved`, link: `/hr/payroll/${runId}` });
    return { id: runId, status: 'APPROVED' as const, financeRunId: fin.id };
  });
}

export const ReturnSchema = z.object({ comment: z.string().trim().min(3, 'Say what needs to change').max(500) });

export async function returnRun(user: Actor, runId: string, raw: unknown) {
  need(user, 'hr.payroll.approve');
  const { comment } = ReturnSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    if (run.status !== 'SUBMITTED') throw new ServiceError('Only a submitted run can be returned.', 409);
    if (run.preparedById === user.id) throw new ServiceError('You prepared this payroll, so someone else must decide on it.', 403);
    await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: 'RETURNED', returnedById: user.id, returnComment: comment } });
    await audit(tx, user, 'HR_RETURN_RUN', 'HrPayrollRun', runId, `Returned the payroll for ${run.month}: ${comment}`, { status: 'SUBMITTED' }, { status: 'RETURNED', comment });
    await notifyUsers(tx, user.schoolId, [run.preparedById], { type: 'HR', title: `Payroll for ${run.month} was returned`, body: comment, link: `/hr/payroll/${runId}` });
    return { id: runId, status: 'RETURNED' as const };
  });
}

export const ReopenSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });

/** Only the Owner, and only before anything has been paid: the Finance hand-over is cancelled and the run goes back to draft. */
export async function reopenRun(user: Actor, runId: string, raw: unknown) {
  const { reason } = ReopenSchema.parse(raw);
  // Approving payroll is the Owner's (hr.payroll.approve), so reopening an approved run is too.
  if (!hrHolds(user, 'hr.payroll.approve')) throw new ServiceError('Only the Owner can reopen an approved payroll run', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    if (run.status === 'PAID') throw new ServiceError('This payroll has been paid and can no longer be reopened. Correct it in next month\'s run with an adjustment line.', 409);
    if (run.status !== 'APPROVED') throw new ServiceError('Only an approved run can be reopened.', 409);
    const fin = run.financeRunId ? await tx.payrollRun.findFirst({ where: { id: run.financeRunId, schoolId: user.schoolId }, include: { lines: true } }) : null;
    if (fin && (fin.status !== 'READY' || fin.lines.some((l) => l.paid))) throw new ServiceError('Finance has already started paying this run, so it cannot be reopened.', 409);
    if (fin) await tx.payrollRun.update({ where: { id: fin.id }, data: { status: 'CANCELLED' } });
    await tx.hrPayrollRun.update({ where: { id: runId }, data: { status: 'DRAFT', approvedById: null, approvedAt: null, financeRunId: null, reopenedById: user.id, reopenReason: reason } });
    await audit(tx, user, 'HR_REOPEN_RUN', 'HrPayrollRun', runId, `Reopened the approved payroll for ${run.month}: ${reason}`, { status: 'APPROVED' }, { status: 'DRAFT', reason });
    await notifyUsers(tx, user.schoolId, [run.preparedById], { type: 'HR', title: `Payroll for ${run.month} was reopened`, body: reason, link: `/hr/payroll/${runId}` });
    await tellHolders(tx, user, 'finance.payroll.pay', { title: `Payroll for ${run.month} was reopened by the Owner`, body: 'It is no longer ready to pay.', link: '/finance/payroll' });
    return { id: runId, status: 'DRAFT' as const };
  });
}

const code = () => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12).toUpperCase();

/**
 * Called by Finance when the last line of a hand-over is paid. The HR run becomes PAID, the loan instalments come off the balances,
 * and each person's payslip is released and they are told.
 */
export async function onFinanceRunPaid(tx: Db, payer: Pick<Actor, 'id' | 'schoolId'>, hrRunId: string) {
  const run = await tx.hrPayrollRun.findFirst({ where: { id: hrRunId, schoolId: payer.schoolId } });
  if (!run || run.status !== 'APPROVED') return;
  await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: 'PAID', paidById: payer.id, paidAt: new Date() } });
  const lines = await tx.hrPayrollLine.findMany({ where: { schoolId: payer.schoolId, runId: run.id } });
  for (const l of lines) {
    for (const d of asLines<DeductionLine>(l.deductions)) {
      if (!d.code.startsWith('LOAN:')) continue;
      const loan = await tx.loan.findFirst({ where: { id: d.code.slice(5), schoolId: payer.schoolId } });
      if (!loan) continue;
      const balance = Math.max(0, loan.balanceCents - d.amountCents);
      await tx.loan.update({ where: { id: loan.id }, data: { balanceCents: balance, status: balance === 0 ? 'REPAID' : 'ACTIVE' } });
    }
  }
  const ids = Array.from(new Set(lines.map((l) => l.employeeId)));
  const emps = await tx.employee.findMany({ where: { schoolId: payer.schoolId, id: { in: ids } } });
  const now = new Date();
  await tx.payslip.createMany({ data: ids.map((employeeId) => ({ schoolId: payer.schoolId, runId: run.id, employeeId, verificationCode: code(), releasedAt: now })), skipDuplicates: true });
  await notifyUsers(tx, payer.schoolId, emps.flatMap((e) => (e.userId ? [e.userId] : [])), { type: 'HR', title: `Your payslip for ${run.month} is ready`, link: '/hr/me/payslips', dedupeKey: `payslip:${run.id}` });
  await audit(tx, payer, 'HR_RUN_PAID', 'HrPayrollRun', run.id, `The payroll for ${run.month} was paid`, { status: 'APPROVED' }, { status: 'PAID', paidById: payer.id });
  await audit(tx, payer, 'HR_RELEASE_PAYSLIPS', 'HrPayrollRun', run.id, `Released ${ids.length} payslips for ${run.month}`);
}

// ─── Looking ─────────────────────────────────────────────────────────────────

export async function listRuns(user: Actor) {
  need(user, 'hr.payroll.view', 'hr.payroll.prepare', 'hr.payroll.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.hrPayrollRun.findMany({ where: { schoolId: user.schoolId }, orderBy: { month: 'desc' }, take: 60 });
    return rows.map((r) => ({ id: r.id, month: r.month, status: r.status, preparedById: r.preparedById, approvedById: r.approvedById, paidById: r.paidById, totals: r.totals, returnComment: r.returnComment }));
  });
}

/** A run with its lines. Opening it shows everyone's pay, so it is logged against each person as a look at their salary. */
export async function getRun(user: Actor, runId: string) {
  need(user, 'hr.payroll.view', 'hr.payroll.prepare', 'hr.payroll.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await loadRun(tx, user.schoolId, runId);
    const [lines, vars] = await Promise.all([
      tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, runId } }),
      tx.hrPayrollVariable.findMany({ where: { schoolId: user.schoolId, runId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: Array.from(new Set([...lines.map((l) => l.employeeId), ...vars.map((v) => v.employeeId)])) } } });
    const depts = await tx.department.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } });
    const eOf = new Map(emps.map((e) => [e.id, e])), dOf = new Map(depts.map((d) => [d.id, d.name]));
    const others = emps.filter((e) => e.userId !== user.id);
    if (others.length) {
      await tx.hrSensitiveView.createMany({ data: others.map((e) => ({ schoolId: user.schoolId, employeeId: e.id, viewerId: user.id, kind: 'SALARY' as const, context: `payroll run ${run.month}` })) });
      await audit(tx, user, 'HR_VIEW_SENSITIVE', 'HrPayrollRun', run.id, `Opened the payroll for ${run.month} (${others.length} people's pay)`);
    }
    const names = await tx.user.findMany({ where: { schoolId: user.schoolId, id: { in: [run.preparedById, run.approvedById, run.paidById, run.returnedById, run.reopenedById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const nm = new Map(names.map((n) => [n.id, n.fullName]));
    return {
      id: run.id, month: run.month, status: run.status, totals: run.totals, returnComment: run.returnComment, reopenReason: run.reopenReason,
      preparedBy: nm.get(run.preparedById) ?? null, approvedBy: run.approvedById ? nm.get(run.approvedById) ?? null : null, paidBy: run.paidById ? nm.get(run.paidById) ?? null : null,
      isPreparer: run.preparedById === user.id,
      lines: lines.map((l) => {
        const e = eOf.get(l.employeeId);
        return { id: l.id, employeeId: l.employeeId, employeeNo: e?.employeeNo ?? '', name: e ? fullName(e) : '?', department: l.departmentId ? dOf.get(l.departmentId) ?? null : null, currency: l.currency, earnings: l.earnings, deductions: l.deductions,
          grossCents: l.grossCents, payeCents: l.payeCents, aidsLevyCents: l.aidsLevyCents, nssaEmployeeCents: l.nssaEmployeeCents, nssaEmployerCents: l.nssaEmployerCents, zimdefCents: l.zimdefCents, netCents: l.netCents, previousNetCents: l.previousNetCents, flags: l.flags ?? [] };
      }).sort((a, b) => a.name.localeCompare(b.name)),
      variables: vars.map((v) => ({ id: v.id, employee: eOf.get(v.employeeId) ? fullName(eOf.get(v.employeeId) as Employee) : '?', kind: v.kind, label: v.label, amountCents: v.amountCents, currency: v.currency, units: v.units, reason: v.reason })),
    };
  });
}
