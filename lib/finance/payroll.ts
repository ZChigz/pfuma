// Payroll hand-over. HR prepares the payroll and the Owner approves it; Finance only pays it, and never the person who prepared it. Until the HR
// module exists a run is handed over by code (handOverPayroll). Paying a line records a Salaries expense in the same transaction, so the cash book
// and the fund reports show it. Statutory remittances (PAYE, NSSA, ZIMDEF, AIDS levy) are listed as due, and paid with a reference.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, currencySchema, dayOf, idSchema, isoDateSchema, need, nameMap, nameOf, textSchema, todayInHarare, ymd, type Actor, centsSchema } from '@/lib/finance/common';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { METHODS } from '@/lib/finance/methods';

const STATUTORY = ['PAYE', 'NSSA', 'ZIMDEF', 'AIDS_LEVY'] as const;

export const HandOverSchema = z.object({
  period: textSchema('the pay period', 3, 20), preparedById: idSchema, approvedById: idSchema, hrRunId: idSchema.optional(),
  lines: z.array(z.object({ employee: textSchema('the employee', 2, 80), employeeRef: z.string().trim().max(40).optional(), currency: currencySchema, netCents: centsSchema, method: z.enum(METHODS), account: z.string().trim().max(60).optional() })).min(1).max(1000),
  statutory: z.array(z.object({ type: z.enum(STATUTORY), currency: currencySchema, amountCents: centsSchema, dueDate: isoDateSchema })).max(20).default([]),
});

/** What HR calls when the Owner approves a payroll run (lib/payroll/run.ts): the lines become "Ready to pay". Not an HTTP route. */
export async function handOverPayroll(tx: Db, schoolId: string, raw: unknown) {
  const input = HandOverSchema.parse(raw);
  if (input.preparedById === input.approvedById) throw new ServiceError('The payroll must be approved by someone other than the person who prepared it', 403);
  const run = await tx.payrollRun.create({
    data: {
      schoolId, period: input.period, preparedById: input.preparedById, approvedById: input.approvedById, status: 'READY', hrRunId: input.hrRunId ?? null,
      lines: { create: input.lines.map((l) => ({ schoolId, employee: l.employee, employeeRef: l.employeeRef || null, currency: l.currency, netCents: l.netCents, method: l.method, account: l.account || null })) },
    },
  });
  for (const s of input.statutory) {
    await tx.statutoryPayment.create({ data: { schoolId, type: s.type, period: input.period, currency: s.currency, amountCents: s.amountCents, dueDate: dayOf(s.dueDate), payrollRunId: run.id } });
  }
  return { id: run.id };
}

export interface PayrollRunView {
  id: string; period: string; status: 'READY' | 'PAID' | 'CANCELLED'; preparedBy: string | null; approvedBy: string | null; paidBy: string | null; paidAt: string | null;
  totals: Record<Cur, number>; paidTotals: Record<Cur, number>;
  lines: { id: string; employee: string; employeeRef: string | null; currency: Cur; netCents: number; method: string; account: string | null; paid: boolean; reference: string | null }[];
  statutory: { id: string; type: string; currency: Cur; amountCents: number; dueDate: string; paidAt: string | null; reference: string | null }[];
}

export async function listPayroll(user: Actor): Promise<PayrollRunView[]> {
  need(user, 'finance.payroll.pay');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const runs = await tx.payrollRun.findMany({ where: { schoolId: user.schoolId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 36, include: { lines: { orderBy: { employee: 'asc' } } } });
    const stat = await tx.statutoryPayment.findMany({ where: { schoolId: user.schoolId, payrollRunId: { in: runs.map((r) => r.id) } }, orderBy: { dueDate: 'asc' } });
    const names = await nameMap(tx, user.schoolId, runs.flatMap((r) => [r.preparedById, r.approvedById, r.paidById]));
    return runs.map((r) => {
      const totals = { USD: 0, ZIG: 0 }; const paidTotals = { USD: 0, ZIG: 0 };
      for (const l of r.lines) { totals[l.currency] += l.netCents; if (l.paid) paidTotals[l.currency] += l.netCents; }
      return {
        id: r.id, period: r.period, status: r.status, preparedBy: nameOf(names, r.preparedById), approvedBy: nameOf(names, r.approvedById), paidBy: nameOf(names, r.paidById), paidAt: r.paidAt?.toISOString() ?? null, totals, paidTotals,
        lines: r.lines.map((l) => ({ id: l.id, employee: l.employee, employeeRef: l.employeeRef, currency: l.currency, netCents: l.netCents, method: l.method, account: l.account, paid: l.paid, reference: l.reference })),
        statutory: stat.filter((s) => s.payrollRunId === r.id).map((s) => ({ id: s.id, type: s.type, currency: s.currency, amountCents: s.amountCents, dueDate: ymd(s.dueDate), paidAt: s.paidAt?.toISOString() ?? null, reference: s.reference })),
      };
    });
  });
}

export const MarkPaidSchema = z.object({ lineIds: z.array(idSchema).min(1).max(1000), reference: z.string().trim().max(80).optional() });

/** Marks lines paid (one or a batch). The person who prepared the run cannot pay it. When every line is paid the run itself becomes PAID. */
export async function markPayrollPaid(user: Actor, runId: string, raw: unknown) {
  need(user, 'finance.payroll.pay');
  const input = MarkPaidSchema.parse(raw);
  const today = todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, schoolId: user.schoolId }, include: { lines: true } });
    if (!run) throw new ServiceError('Payroll run not found', 404);
    if (run.status === 'CANCELLED') throw new ServiceError('The Owner reopened this payroll in HR. Wait for it to be approved again.', 409);
    if (run.status === 'PAID') throw new ServiceError('This payroll has already been paid', 409);
    if (run.preparedById === user.id) throw new ServiceError('You prepared this payroll, so someone else must pay it.', 403);
    const picked = run.lines.filter((l) => input.lineIds.includes(l.id));
    if (picked.length !== new Set(input.lineIds).size) throw new ServiceError('A line does not belong to this payroll', 404);
    if (picked.some((l) => l.paid)) throw new ServiceError('A line you chose is already paid', 409);
    const fund = (await tx.fund.findFirst({ where: { schoolId: user.schoolId, kind: 'GENERAL', active: true } })) ?? (await tx.fund.findFirst({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' } }));
    if (!fund) throw new ServiceError('Set up a fund before paying salaries', 409);
    const cat = await tx.expenseCategory.findFirst({ where: { schoolId: user.schoolId, name: 'Salaries' } });
    for (const l of picked) {
      await tx.payrollLine.update({ where: { id: l.id }, data: { paid: true, reference: input.reference || null } });
      const e = await tx.finExpense.create({
        data: {
          schoolId: user.schoolId, fundId: fund.id, category: 'Salaries', categoryId: cat?.id ?? null, description: `Salary ${run.period}: ${l.employee}`, payee: l.employee, currency: l.currency, amountCents: l.netCents,
          paidOn: dayOf(today), method: l.method, reference: input.reference || null, source: 'DIRECT', payrollRunId: run.id, recordedById: user.id,
        },
      });
      await audit(tx, user, 'PAY_PAYROLL', 'FinExpense', e.id, `Paid ${l.employee}'s salary for ${run.period}: ${formatMoney(l.netCents, l.currency)}`, { paid: false }, {
        runId: run.id, lineId: l.id, currency: l.currency, amountCents: l.netCents, method: l.method, reference: input.reference ?? null,
      });
    }
    const remaining = run.lines.filter((l) => !l.paid && !input.lineIds.includes(l.id)).length;
    if (remaining === 0) {
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID', paidById: user.id, paidAt: new Date() } });
      await audit(tx, user, 'PAY_PAYROLL', 'PayrollRun', run.id, `Payroll for ${run.period} fully paid`, { status: 'READY' }, { status: 'PAID', paidById: user.id });
      // HR learns that its run is paid: payslips are released, loan balances go down.
      if (run.hrRunId) await (await import('@/lib/payroll/run')).onFinanceRunPaid(tx, user, run.hrRunId);
    }
    return { paid: picked.length, runPaid: remaining === 0 };
  });
}

export const StatutoryPaidSchema = z.object({ reference: textSchema('the payment reference', 2, 80) });

/** Records that a statutory remittance was paid; its amount joins the expenses (category Statutory). */
export async function markStatutoryPaid(user: Actor, id: string, raw: unknown) {
  need(user, 'finance.payroll.pay');
  const { reference } = StatutoryPaidSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.statutoryPayment.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!s) throw new ServiceError('Statutory payment not found', 404);
    if (s.paidAt) throw new ServiceError('This remittance has already been paid', 409);
    const run = s.payrollRunId ? await tx.payrollRun.findFirst({ where: { id: s.payrollRunId, schoolId: user.schoolId }, select: { preparedById: true, status: true } }) : null;
    if (run?.status === 'CANCELLED') throw new ServiceError('The Owner reopened this payroll in HR, so this remittance is not due.', 409);
    if (run?.preparedById === user.id) throw new ServiceError('You prepared this payroll, so someone else must pay it.', 403);
    const fund = (await tx.fund.findFirst({ where: { schoolId: user.schoolId, kind: 'GENERAL', active: true } })) ?? (await tx.fund.findFirst({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' } }));
    if (!fund) throw new ServiceError('Set up a fund before paying', 409);
    await tx.statutoryPayment.update({ where: { id }, data: { paidAt: new Date(), paidById: user.id, reference } });
    const e = await tx.finExpense.create({
      data: {
        schoolId: user.schoolId, fundId: fund.id, category: 'Statutory', description: `${s.type.replace('_', ' ')} for ${s.period}`, payee: s.type.replace('_', ' '), currency: s.currency, amountCents: s.amountCents,
        paidOn: dayOf(todayInHarare()), method: 'BANK_TRANSFER', reference, source: 'DIRECT', payrollRunId: s.payrollRunId, recordedById: user.id,
      } as Prisma.FinExpenseUncheckedCreateInput,
    });
    await audit(tx, user, 'PAY_PAYROLL', 'StatutoryPayment', id, `Paid ${s.type} for ${s.period}: ${formatMoney(s.amountCents, s.currency)}`, { paidAt: null }, { paidById: user.id, reference, expenseId: e.id });
    return { id };
  });
}

/** Remittances not yet paid, soonest first, with how many days remain (negative: overdue). */
export async function statutoryDue(user: Actor) {
  need(user, 'finance.payroll.pay', 'finance.dashboard.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const cancelled = (await tx.payrollRun.findMany({ where: { schoolId: user.schoolId, status: 'CANCELLED' }, select: { id: true } })).map((r) => r.id);
    const rows = await tx.statutoryPayment.findMany({ where: { schoolId: user.schoolId, paidAt: null, ...(cancelled.length ? { OR: [{ payrollRunId: null }, { payrollRunId: { notIn: cancelled } }] } : {}) }, orderBy: { dueDate: 'asc' }, take: 50 });
    const today = dayOf(todayInHarare()).getTime();
    return rows.map((s) => ({ id: s.id, type: s.type, period: s.period, currency: s.currency as Cur, amountCents: s.amountCents, dueDate: ymd(s.dueDate), daysLeft: Math.round((s.dueDate.getTime() - today) / 86_400_000) }));
  });
}

/** CSV for the bank's bulk-payment upload: employee, account, currency, amount. Only unpaid lines. */
export async function payrollBulkFile(user: Actor, runId: string): Promise<string> {
  need(user, 'finance.payroll.pay');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const run = await tx.payrollRun.findFirst({ where: { id: runId, schoolId: user.schoolId }, include: { lines: { where: { paid: false }, orderBy: { employee: 'asc' } } } });
    if (!run) throw new ServiceError('Payroll run not found', 404);
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = run.lines.map((l) => [q(l.employee), q(l.account ?? ''), l.currency, (l.netCents / 100).toFixed(2), q(l.method), q(`Salary ${run.period}`)].join(','));
    return ['Employee,Account,Currency,Amount,Method,Narrative', ...rows].join('\n') + '\n';
  });
}
