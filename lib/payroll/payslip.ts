// Payslips. Made when the payroll run is paid (Finance marks the last line paid) and released to staff then. A person sees their own;
// anyone else with payroll access sees them only through a logged look. Each payslip has a verification code (and QR) anyone can check.
import { ServiceError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { fullName, runsIn, hrHolds, isoOf, logSensitiveView, need, ownEmployee, todayInHarare, type Actor } from '@/lib/hr/common';
import { balanceOf } from '@/lib/hr/leave';
import type { Cur, DeductionLine, EarningLine } from '@/lib/payroll/calc';
import { monthRange } from '@/lib/hr/common';

const last4 = (s: string | null | undefined) => (s ? `••••${s.replace(/\s/g, '').slice(-4)}` : null);
const METHOD_TEXT = { BANK: 'Bank transfer', ECOCASH: 'EcoCash', CASH: 'Cash' } as const;

export interface PayslipCurrency {
  currency: Cur; earnings: EarningLine[]; deductions: { label: string; amountCents: number }[]; grossCents: number; totalDeductionsCents: number; netCents: number;
  ytd: { grossCents: number; payeCents: number; nssaCents: number };
}

export interface PayslipData {
  verificationCode: string; verifyPath: string; month: string; releasedAt: string | null;
  school: { name: string; logoUrl: string | null; address: string | null };
  employee: { name: string; employeeNo: string; jobTitle: string; department: string | null; nssaNo: string | null; taxNo: string | null; paymentMethod: string | null };
  currencies: PayslipCurrency[]; leaveBalance: { name: string; remaining: number; asAt: string } | null;
}

export async function buildPayslip(tx: Db, schoolId: string, runId: string, employeeId: string): Promise<PayslipData> {
  const [run, slip, e, school] = await Promise.all([
    tx.hrPayrollRun.findFirst({ where: { id: runId, schoolId } }),
    tx.payslip.findFirst({ where: { runId, employeeId, schoolId } }),
    tx.employee.findFirst({ where: { id: employeeId, schoolId } }),
    tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, logoUrl: true, address: true } }),
  ]);
  if (!run || !slip || !e) throw new ServiceError('Payslip not found', 404);
  const year = run.month.slice(0, 4);
  const [lines, pay, dept, ytdLines] = await Promise.all([
    tx.hrPayrollLine.findMany({ where: { schoolId, runId, employeeId } }),
    tx.employeePay.findUnique({ where: { employeeId } }),
    e.departmentId ? tx.department.findFirst({ where: { id: e.departmentId, schoolId }, select: { name: true } }) : null,
    runsIn(tx, schoolId, ['PAID'], `${year}-01`, run.month).then((rs) => tx.hrPayrollLine.findMany({ where: { schoolId, employeeId, runId: { in: rs.map((r) => r.id) } } })),
  ]);
  const currencies: PayslipCurrency[] = (['USD', 'ZIG'] as Cur[]).flatMap((c) => {
    const l = lines.find((x) => x.currency === c);
    if (!l) return [];
    const other = (l.deductions as unknown as DeductionLine[]) ?? [];
    const deductions = [
      { label: 'PAYE', amountCents: l.payeCents }, { label: 'AIDS levy', amountCents: l.aidsLevyCents }, { label: 'NSSA', amountCents: l.nssaEmployeeCents },
      ...other.map((d) => ({ label: d.label, amountCents: d.amountCents })),
    ].filter((d) => d.amountCents > 0);
    const ytd = ytdLines.filter((x) => x.currency === c);
    return [{
      currency: c, earnings: (l.earnings as unknown as EarningLine[]) ?? [], deductions, grossCents: l.grossCents, totalDeductionsCents: deductions.reduce((s, d) => s + d.amountCents, 0), netCents: l.netCents,
      ytd: { grossCents: ytd.reduce((s, x) => s + x.grossCents, 0), payeCents: ytd.reduce((s, x) => s + x.payeCents + x.aidsLevyCents, 0), nssaCents: ytd.reduce((s, x) => s + x.nssaEmployeeCents, 0) },
    }];
  });
  const vac = await tx.leaveType.findFirst({ where: { schoolId, code: 'VACATION' } });
  const asAt = monthRange(run.month).last;
  const bal = vac ? await balanceOf(tx, schoolId, e, vac, Number(year), asAt) : null;
  return {
    verificationCode: slip.verificationCode, verifyPath: `/verify/payslip/${slip.verificationCode}`, month: run.month, releasedAt: slip.releasedAt?.toISOString() ?? null, school,
    employee: { name: fullName(e, true), employeeNo: e.employeeNo, jobTitle: e.jobTitle, department: dept?.name ?? null, nssaNo: last4(pay?.nssaNo), taxNo: last4(pay?.zimraTaxNo), paymentMethod: pay ? METHOD_TEXT[pay.paymentMethod] : null },
    currencies, leaveBalance: bal ? { name: bal.name, remaining: bal.remaining, asAt } : null,
  };
}

/** One payslip. Your own once released; anyone else's needs payroll access and is logged as a look at that person's payslip. */
export async function getPayslip(user: Actor, runId: string, employeeId?: string): Promise<PayslipData> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    const target = employeeId ?? me?.id;
    if (!target) throw new ServiceError('You have no staff record yet. Ask HR to link your login to it.', 404);
    const e = await tx.employee.findFirst({ where: { id: target, schoolId: user.schoolId } });
    if (!e) throw new ServiceError('Payslip not found', 404);
    const own = e.userId === user.id;
    if (own) need(user, 'hr.self.payslips');
    else need(user, 'hr.payroll.view');
    const slip = await tx.payslip.findFirst({ where: { runId, employeeId: target, schoolId: user.schoolId } });
    if (!slip?.releasedAt) throw new ServiceError('This payslip has not been released yet. Payslips are released when the payroll is paid.', 404);
    if (!own) await logSensitiveView(tx, user, e, 'PAYSLIP', `payslip ${slip.verificationCode}`);
    return buildPayslip(tx, user.schoolId, runId, target);
  });
}

export async function listMyPayslips(user: Actor) {
  need(user, 'hr.self.payslips');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    if (!me) return [];
    const slips = await tx.payslip.findMany({ where: { schoolId: user.schoolId, employeeId: me.id, releasedAt: { not: null } } });
    const runs = new Map((await tx.hrPayrollRun.findMany({ where: { schoolId: user.schoolId, id: { in: slips.map((s) => s.runId) } } })).map((r) => [r.id, r.month]));
    const lines = await tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, employeeId: me.id, runId: { in: slips.map((s) => s.runId) } } });
    return slips.map((s) => ({ runId: s.runId, month: runs.get(s.runId) ?? '', releasedAt: s.releasedAt!.toISOString(), net: lines.filter((l) => l.runId === s.runId).map((l) => ({ currency: l.currency, netCents: l.netCents })) })).sort((a, b) => b.month.localeCompare(a.month));
  });
}

/** The year-end summary for tax purposes: what was earned and withheld in each currency in a year. */
export async function yearEndSummary(user: Actor, year = Number(todayInHarare().slice(0, 4))) {
  need(user, 'hr.self.payslips');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    if (!me) throw new ServiceError('You have no staff record yet.', 404);
    const lines = await tx.hrPayrollLine.findMany({ where: { schoolId: user.schoolId, employeeId: me.id, runId: { in: (await runsIn(tx, user.schoolId, ['PAID'], `${year}-01`, `${year}-12`)).map((r) => r.id) } } });
    const pay = await tx.employeePay.findUnique({ where: { employeeId: me.id } });
    const per = (['USD', 'ZIG'] as Cur[]).map((c) => {
      const ls = lines.filter((l) => l.currency === c);
      return { currency: c, months: ls.length, grossCents: ls.reduce((s, l) => s + l.grossCents, 0), payeCents: ls.reduce((s, l) => s + l.payeCents, 0), aidsLevyCents: ls.reduce((s, l) => s + l.aidsLevyCents, 0), nssaCents: ls.reduce((s, l) => s + l.nssaEmployeeCents, 0), netCents: ls.reduce((s, l) => s + l.netCents, 0) };
    }).filter((p) => p.months > 0);
    return { year, employee: fullName(me, true), employeeNo: me.employeeNo, taxNo: last4(pay?.zimraTaxNo), currencies: per };
  });
}

/** Public: is this a real payslip? Shows only that it exists, its month, the school, and the employee's name (surname shortened). */
export async function verifyPayslip(code: string) {
  if (!/^[A-Z0-9]{8,20}$/.test(code)) return { valid: false as const };
  const slip = await prisma.payslip.findUnique({ where: { verificationCode: code } });
  if (!slip?.releasedAt) return { valid: false as const };
  const [run, e, school] = await Promise.all([
    prisma.hrPayrollRun.findUnique({ where: { id: slip.runId }, select: { month: true } }),
    prisma.employee.findUnique({ where: { id: slip.employeeId }, select: { firstName: true, surname: true } }),
    prisma.school.findUnique({ where: { id: slip.schoolId }, select: { name: true } }),
  ]);
  return { valid: true as const, month: run?.month ?? '', school: school?.name ?? '', employee: e ? `${e.firstName} ${e.surname.slice(0, 1)}.` : '', releasedOn: isoOf(slip.releasedAt) };
}

export { hrHolds };
