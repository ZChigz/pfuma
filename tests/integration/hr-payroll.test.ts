// @vitest-environment node
// Payroll against a real PostgreSQL: the worked example through the whole system, three different people before money leaves, a locked
// run, the hand-over to Finance, payslips released only when paid and seen only by their owner (or through a logged look), the
// Owner's reopen, corrections in the next month, and the rule that government-paid staff are never in a run.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { fails, hrWorld, type HrWorld } from '../helpers/hr';

let t: TestDb;
let A: SeededSchool;
let W: HrWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let emp: typeof import('@/lib/hr/employees');
let run: typeof import('@/lib/payroll/run');
let pset: typeof import('@/lib/payroll/settings-service');
let slip: typeof import('@/lib/payroll/payslip');
let rec: typeof import('@/lib/hr/recruitment');
let fin: typeof import('@/lib/finance/payroll');
let finSetup: typeof import('@/lib/finance/setup');
let reports: typeof import('@/lib/hr/reports');

const NOW = new Date('2026-11-16T08:00:00Z');
const ids: Record<string, string> = {};
const line = async (runId: string, employeeId: string, currency: 'USD' | 'ZIG') => prisma.hrPayrollLine.findFirstOrThrow({ where: { runId, employeeId, currency } });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [emp, run, pset, slip, rec, fin, finSetup, reports] = await Promise.all([
    import('@/lib/hr/employees'), import('@/lib/payroll/run'), import('@/lib/payroll/settings-service'), import('@/lib/payroll/payslip'), import('@/lib/hr/recruitment'),
    import('@/lib/finance/payroll'), import('@/lib/finance/setup'), import('@/lib/hr/reports'),
  ]);
  A = await seedSchool(prisma, 'School A');
  await seedSchool(prisma, 'School B');
  W = await hrWorld(prisma, A);
  await finSetup.listFunds(W.bursar);
  await pset.getPayrollSettings(W.hr);

  const gov = await rec.addGovernmentTeacher(W.hr, { firstName: 'Tendai', surname: 'Moyo', ecNumber: 'EC123456', postedOn: '2026-01-12' });
  ids.gov = gov.id;
  const mk = async (firstName: string, surname: string, startDate: string, job = 'Groundsman') => (await emp.createEmployee(W.hr, { firstName, surname, jobTitle: job, category: 'GROUNDS', employer: 'SCHOOL', startDate })).id;
  ids.alice = await mk('Alice', 'Banda', '2026-01-05');
  ids.bob = await mk('Bob', 'Chuma', '2026-01-05');
  ids.carl = await mk('Carl', 'Dube', '2026-02-01');
  ids.dina = await mk('Dina', 'Eze', '2026-10-16');
  await emp.linkUser(W.hr, ids.alice, { userId: W.teacher2.id });
  await emp.setPay(W.hr, ids.alice, { paymentMethod: 'BANK', bankName: 'CBZ', accountNumber: '1234567890', basicUsdCents: 50000, zimraTaxNo: 'TAX99887', nssaNo: 'NSSA55512', reason: 'Initial set-up' });
  await emp.setPay(W.hr, ids.bob, { paymentMethod: 'ECOCASH', ecocashNumber: '0771112222', basicUsdCents: 40000, basicZigCents: 270000, reason: 'Initial set-up' });
  await emp.setPay(W.hr, ids.carl, { paymentMethod: 'CASH', payBasis: 'DAILY', rateCents: 2000, rateCurrency: 'USD', reason: 'Initial set-up' });
  await emp.setPay(W.hr, ids.dina, { paymentMethod: 'CASH', basicUsdCents: 31000, reason: 'Initial set-up' });
  const days = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'];
  await prisma.staffAttendance.createMany({ data: days.map((d, i) => ({ schoolId: A.schoolId, employeeId: ids.carl!, date: new Date(d), status: i === 9 ? ('HALF_DAY' as const) : ('PRESENT' as const), markedById: W.hr.id })) });
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

describe('settings the accountant must confirm', () => {
  it('seeds today\'s figures as editable defaults, unconfirmed', async () => {
    const s = await pset.getPayrollSettings(W.hr);
    expect(s.tables.USD[0]!.value).toEqual([{ fromCents: 0, rateBps: 0 }, { fromCents: 10000, rateBps: 2000 }, { fromCents: 30000, rateBps: 2500 }, { fromCents: 300000, rateBps: 4000 }]);
    expect(s.rates[0]!.value).toMatchObject({ aidsLevyBps: 300, nssaEmployeeBps: 450, nssaEmployerBps: 450, zimdefBps: 100, nssaDeductibleBeforePaye: false });
    expect(s.rates[0]!.value.nssaCeilingCents.USD).toBe(70000);
    expect(s.tables.USD[0]!.confirmed).toBe(false);
    expect(s.rates[0]!.confirmed).toBe(false);
  });

  it('no run can be made until the tax tables and rates in force are confirmed', async () => {
    await fails(run.createRun(W.hr, { month: '2026-10' }), 409, /not been confirmed/);
    await fails(pset.confirmSetting(W.teacher, { kind: 'TAX_TABLE', id: 'x' }), 403);
    const s = await pset.getPayrollSettings(W.bursar);
    await pset.confirmSetting(W.bursar, { kind: 'TAX_TABLE', id: s.tables.USD[0]!.id });
    await fails(run.createRun(W.hr, { month: '2026-10' }), 409, /statutory rates/);
    await pset.confirmSetting(W.bursar, { kind: 'RATES', id: s.rates[0]!.id });
    await fails(run.createRun(W.hr, { month: '2026-10' }), 409, /ZIG tax table/);
    await pset.confirmSetting(W.bursar, { kind: 'TAX_TABLE', id: s.tables.ZIG[0]!.id });
    await fails(pset.confirmSetting(W.bursar, { kind: 'RATES', id: s.rates[0]!.id }), 409);
  });

  it('tables and rates are never edited, only added with a later date', async () => {
    await expect(t.pg.query(`UPDATE "StatutoryRate" SET "zimdefBps" = 500`)).rejects.toThrow(/cannot be edited/);
    await expect(t.pg.query(`DELETE FROM "TaxBand"`)).rejects.toThrow(/only be added/);
    await fails(pset.saveTaxTable(W.hr, { currency: 'USD', effectiveFrom: '2026-01-01', bands: [{ fromCents: 0, rateBps: 0 }] }), 409);
    await fails(pset.saveTaxTable(W.hr, { currency: 'USD', effectiveFrom: '2027-01-01', bands: [{ fromCents: 100, rateBps: 0 }] }), 422);
    await fails(pset.saveTaxTable(W.teacher, { currency: 'USD', effectiveFrom: '2027-01-01', bands: [{ fromCents: 0, rateBps: 0 }] }), 403);
  });
});

describe('the October run: the worked example through the system', () => {
  it('includes school-paid staff only, and works out each line', async () => {
    const r = await run.createRun(W.hr, { month: '2026-10' });
    ids.oct = r.id;
    await fails(run.createRun(W.hr2, { month: '2026-10' }), 409, /already/);
    const lines = await prisma.hrPayrollLine.findMany({ where: { runId: r.id } });
    expect(lines.some((l) => l.employeeId === ids.gov)).toBe(false);
    const a = await line(r.id, ids.alice!, 'USD');
    expect(a).toMatchObject({ grossCents: 50000, payeCents: 9000, aidsLevyCents: 270, nssaEmployeeCents: 2250, netCents: 38480, nssaEmployerCents: 2250, zimdefCents: 500 });
    expect(a.grossCents + a.nssaEmployerCents + a.zimdefCents).toBe(52750);
  });

  it('pays in two currencies: each is taxed with its own table and totalled on its own', async () => {
    const usd = await line(ids.oct!, ids.bob!, 'USD');
    const zig = await line(ids.oct!, ids.bob!, 'ZIG');
    expect(usd.grossCents).toBe(40000);
    expect(usd.payeCents).toBe(6500);          // 20% of 200 + 25% of 100
    expect(zig.grossCents).toBe(270000);
    expect(zig.payeCents).toBe(0);              // under ZiG 2,800
    expect(zig.nssaEmployeeCents).toBe(12150); // no ceiling in ZiG
    const g = await run.getRun(W.hr, ids.oct!);
    const totals = g.totals as { total: { USD: { grossCents: number; people: number }; ZIG: { grossCents: number; people: number } } };
    expect(totals.total.ZIG).toMatchObject({ grossCents: 270000, people: 1 });
    expect(totals.total.USD.people).toBe(4);
  });

  it('a new joiner is paid by days, a casual by days worked from the register', async () => {
    const d = await line(ids.oct!, ids.dina!, 'USD');
    expect(d.grossCents).toBe(16000);          // 16 of 31 days of 310.00
    const c = await line(ids.oct!, ids.carl!, 'USD');
    expect(c.grossCents).toBe(19000);          // 9 days + a half day, at 20.00
  });

  it('one-off items: overtime, a bonus, unpaid days, and a correction that needs a reason', async () => {
    await fails(run.addVariable(W.hr2, ids.oct!, { employeeId: ids.alice, kind: 'BONUS', label: 'Bonus', amountCents: 1000 }), 403, /someone else/);
    await fails(run.addVariable(W.hr, ids.oct!, { employeeId: ids.gov, kind: 'BONUS', label: 'Bonus', amountCents: 1000 }), 409, /never in the school payroll/);
    await fails(run.addVariable(W.hr, ids.oct!, { employeeId: ids.alice, kind: 'ADJUSTMENT', label: 'Underpaid', amountCents: 2000 }), 422, /reason/);
    const ot = await run.addVariable(W.hr, ids.oct!, { employeeId: ids.alice, kind: 'OVERTIME', label: 'Overtime', units: 10, rateCents: 300 });
    expect(ot.amountCents).toBe(3000);
    await run.recalculateRun(W.hr, ids.oct!);
    const a = await line(ids.oct!, ids.alice!, 'USD');
    expect(a.grossCents).toBe(53000);
    await run.removeVariable(W.hr, ids.oct!, ot.id);
    await run.addVariable(W.hr, ids.oct!, { employeeId: ids.bob, kind: 'UNPAID_DAYS', label: 'Unpaid leave', units: 3 });
    await run.recalculateRun(W.hr, ids.oct!);
    expect((await line(ids.oct!, ids.alice!, 'USD')).grossCents).toBe(50000);
    expect((await line(ids.oct!, ids.bob!, 'USD')).grossCents).toBeLessThan(40000);
  });

  it('a loan is deducted as an instalment, never more than what is left', async () => {
    const l = await emp.createLoan(W.hr, { employeeId: ids.bob, principalCents: 6000, instalmentCents: 4000, startMonth: '2026-10', reason: 'Salary advance' });
    ids.loan = l.id;
    await run.recalculateRun(W.hr, ids.oct!);
    const b = await line(ids.oct!, ids.bob!, 'USD');
    expect((b.deductions as { code: string; amountCents: number }[]).find((d) => d.code.startsWith('LOAN'))?.amountCents).toBe(4000);
  });

  it('three different people: the preparer cannot approve, an Administrator is not the Owner, and the run locks on submit', async () => {
    await fails(run.approveRun(W.owner, ids.oct!), 409, /submitted/);
    await run.submitRun(W.hr, ids.oct!);
    await fails(run.submitRun(W.hr, ids.oct!), 409);
    await fails(run.addVariable(W.hr, ids.oct!, { employeeId: ids.alice, kind: 'BONUS', label: 'Late', amountCents: 100 }), 409, /submitted/);
    await expect(t.pg.query(`UPDATE "HrPayrollLine" SET "netCents" = 1 WHERE "runId" = '${ids.oct}'`)).rejects.toThrow(/cannot be changed/);
    await expect(t.pg.query(`DELETE FROM "HrPayrollLine" WHERE "runId" = '${ids.oct}'`)).rejects.toThrow(/cannot be changed/);
    await fails(run.approveRun(W.hr, ids.oct!), 403);       // HR has no approval right
    await fails(run.approveRun(W.admin, ids.oct!), 403);    // "*" is not the Owner
    await fails(run.approveRun(W.head, ids.oct!), 403);
    await expect(t.pg.query(`UPDATE "HrPayrollRun" SET "status" = 'APPROVED', "approvedById" = "preparedById", "approvedAt" = now() WHERE id = '${ids.oct}'`)).rejects.toThrow(/HrPayrollRun_people/);
    await expect(t.pg.query(`UPDATE "HrPayrollRun" SET "status" = 'PAID', "paidById" = "preparedById", "paidAt" = now(), "approvedById" = '${W.owner.id}', "approvedAt" = now() WHERE id = '${ids.oct}'`)).rejects.toThrow();
  });

  it('the Owner can return it with a comment, and the preparer reworks and submits again', async () => {
    await fails(run.returnRun(W.owner, ids.oct!, { comment: '' }), 422);
    await run.returnRun(W.owner, ids.oct!, { comment: 'Check Bob\'s unpaid days' });
    expect((await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.oct } })).status).toBe('RETURNED');
    expect((await prisma.notification.findMany({ where: { userId: W.hr.id, title: { contains: 'was returned' } } })).length).toBe(1);
    const v = await prisma.hrPayrollVariable.findFirstOrThrow({ where: { runId: ids.oct, kind: 'UNPAID_DAYS' } });
    await run.removeVariable(W.hr, ids.oct!, v.id);
    await run.submitRun(W.hr, ids.oct!);
  });

  it('approval hands the net pay and the statutory amounts to Finance, and the run can no longer change', async () => {
    const a = await run.approveRun(W.owner, ids.oct!);
    expect(a.status).toBe('APPROVED');
    const hr = await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.oct } });
    expect(hr).toMatchObject({ status: 'APPROVED', approvedById: W.owner.id });
    const f = await prisma.payrollRun.findUniqueOrThrow({ where: { id: hr.financeRunId! }, include: { lines: true } });
    expect(f).toMatchObject({ status: 'READY', hrRunId: ids.oct, period: '2026-10', preparedById: W.hr.id, approvedById: W.owner.id });
    expect(f.lines.length).toBe(5);              // Alice, Bob USD, Bob ZiG, Carl, Dina
    expect(f.lines.find((l) => l.employee === 'Bob Chuma' && l.currency === 'ZIG')).toMatchObject({ method: 'ECOCASH', account: '+263771112222' });
    const stat = await prisma.statutoryPayment.findMany({ where: { payrollRunId: f.id } });
    const lines = await prisma.hrPayrollLine.findMany({ where: { runId: ids.oct } });
    const usd = lines.filter((l) => l.currency === 'USD');
    expect(stat.find((s) => s.type === 'PAYE' && s.currency === 'USD')!.amountCents).toBe(usd.reduce((s, l) => s + l.payeCents, 0));
    expect(stat.find((s) => s.type === 'NSSA' && s.currency === 'USD')!.amountCents).toBe(usd.reduce((s, l) => s + l.nssaEmployeeCents + l.nssaEmployerCents, 0));
    expect(stat.find((s) => s.type === 'ZIMDEF' && s.currency === 'USD')!.amountCents).toBe(usd.reduce((s, l) => s + l.zimdefCents, 0));
    expect(stat.find((s) => s.type === 'PAYE' && s.currency === 'USD')!.dueDate.toISOString().slice(0, 10)).toBe('2026-11-10');
    await fails(run.recalculateRun(W.hr, ids.oct!), 409);
    await expect(t.pg.query(`UPDATE "HrPayrollLine" SET "payeCents" = 1 WHERE "runId" = '${ids.oct}'`)).rejects.toThrow(/cannot be changed/);
    await expect(t.pg.query(`UPDATE "HrPayrollRun" SET "month" = '2026-09' WHERE id = '${ids.oct}'`)).rejects.toThrow(/cannot be changed/);
  });

  it('payslips are not released before the run is paid', async () => {
    await fails(slip.getPayslip(W.teacher2, ids.oct!), 404, /not been released/);
    expect(await prisma.payslip.count({ where: { runId: ids.oct } })).toBe(0);
  });

  it('Finance pays (not the preparer); the run is then paid, payslips are released, loan balances go down', async () => {
    const f = await fin.listPayroll(W.bursar);
    const fr = f.find((x) => x.period === '2026-10')!;
    await fails(fin.markPayrollPaid(W.hr, fr.id, { lineIds: fr.lines.map((l) => l.id) }), 403);
    await fin.markPayrollPaid(W.bursar, fr.id, { lineIds: fr.lines.slice(0, 2).map((l) => l.id) });
    expect((await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.oct } })).status).toBe('APPROVED');
    await fin.markPayrollPaid(W.bursar, fr.id, { lineIds: fr.lines.slice(2).map((l) => l.id), reference: 'RTGS-001' });
    const hr = await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.oct } });
    expect(hr).toMatchObject({ status: 'PAID', paidById: W.bursar.id });
    expect(await prisma.payslip.count({ where: { runId: ids.oct, releasedAt: { not: null } } })).toBe(4);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: ids.loan } })).balanceCents).toBe(2000);
    expect((await prisma.notification.findMany({ where: { userId: W.teacher2.id, title: { contains: 'payslip' } } })).length).toBe(1);
    await fails(run.reopenRun(W.owner, ids.oct!, { reason: 'Mistake found later' }), 409, /paid/);
  });

  it('a payslip shows both currencies, masks the numbers, and gives the year to date and the leave balance', async () => {
    const p = await slip.getPayslip(W.teacher2, ids.oct!);
    expect(p.employee).toMatchObject({ name: 'Alice Banda', employeeNo: 'EMP-0002', nssaNo: '••••5512', taxNo: '••••9887', paymentMethod: 'Bank transfer' });
    expect(p.currencies).toHaveLength(1);
    expect(p.currencies[0]).toMatchObject({ currency: 'USD', grossCents: 50000, netCents: 38480, ytd: { grossCents: 50000, payeCents: 9270, nssaCents: 2250 } });
    expect(p.currencies[0]!.deductions.map((d) => d.label)).toEqual(['PAYE', 'AIDS levy', 'NSSA']);
    expect(p.leaveBalance).not.toBeNull();
    expect(p.verifyPath).toMatch(/^\/verify\/payslip\/[A-Z0-9]{12}$/);
    const bobId = await prisma.employee.update({ where: { id: ids.bob }, data: { userId: W.outsider.id } });
    void bobId;
    const bob = await slip.getPayslip(W.outsider, ids.oct!);
    expect(bob.currencies.map((c) => c.currency)).toEqual(['USD', 'ZIG']);
  });

  it('nobody sees someone else\'s payslip; HR and the Owner do through a logged look; the Administrator does not', async () => {
    await fails(slip.getPayslip(W.teacher2, ids.oct!, ids.bob), 403);
    await fails(slip.getPayslip(W.admin, ids.oct!, ids.alice), 403);
    await fails(slip.getPayslip(W.head, ids.oct!, ids.alice), 403);
    const before = await prisma.hrSensitiveView.count({ where: { employeeId: ids.alice, kind: 'PAYSLIP' } });
    await slip.getPayslip(W.hr, ids.oct!, ids.alice);
    await slip.getPayslip(W.owner, ids.oct!, ids.alice);
    expect(await prisma.hrSensitiveView.count({ where: { employeeId: ids.alice, kind: 'PAYSLIP' } })).toBe(before + 2);
    const mine = await slip.listMyPayslips(W.teacher2);
    expect(mine[0]).toMatchObject({ month: '2026-10' });
    const year = await slip.yearEndSummary(W.teacher2, 2026);
    expect(year.currencies[0]).toMatchObject({ currency: 'USD', grossCents: 50000, payeCents: 9000 });
  });

  it('opening the run logs a look at everyone\'s pay; the verification code can be checked by anyone', async () => {
    const before = await prisma.hrSensitiveView.count({ where: { viewerId: W.owner.id, kind: 'SALARY' } });
    await run.getRun(W.owner, ids.oct!);
    expect(await prisma.hrSensitiveView.count({ where: { viewerId: W.owner.id, kind: 'SALARY' } })).toBeGreaterThan(before);
    await fails(run.getRun(W.admin, ids.oct!), 403);
    await fails(run.getRun(W.teacher, ids.oct!), 403);
    const code = (await prisma.payslip.findFirstOrThrow({ where: { runId: ids.oct, employeeId: ids.alice } })).verificationCode;
    expect(await slip.verifyPayslip(code)).toMatchObject({ valid: true, month: '2026-10', employee: 'Alice B.' });
    expect(await slip.verifyPayslip('NOTACODE1234')).toEqual({ valid: false });
  });
});

describe('the next month: corrections, flags, reopen', () => {
  it('a mistake is corrected in the next month with an adjustment line and a reason; a big move in net pay is flagged with its cause', async () => {
    const comps = await prisma.payComponent.findMany({ where: { schoolId: A.schoolId } });
    await emp.saveComponent(W.hr, ids.bob!, { componentId: comps.find((c) => c.code === 'HOUSING')!.id, amountCents: 20000, startsOn: '2026-11-01', reason: 'Housing allowance agreed' });
    const r = await run.createRun(W.hr, { month: '2026-11' });
    ids.nov = r.id;
    await run.addVariable(W.hr, ids.nov, { employeeId: ids.alice, kind: 'ADJUSTMENT', label: 'October overtime not paid', amountCents: 3000, reason: 'Overtime for October was left out' });
    await run.recalculateRun(W.hr, ids.nov);
    const a = await line(ids.nov, ids.alice!, 'USD');
    expect(a.grossCents).toBe(53000);
    expect(a.previousNetCents).toBe(38480);
    const b = await line(ids.nov, ids.bob!, 'USD');
    const flags = b.flags as { code: string; message: string }[];
    expect(flags.find((f) => f.code === 'NET_CHANGE')?.message).toMatch(/Housing allowance/);
    expect(((await line(ids.nov, ids.alice!, 'USD')).flags as unknown[] | null) ?? []).toHaveLength(0);
  });

  it('a loan stops when repaid: the last instalment is only what is left', async () => {
    const b = await line(ids.nov!, ids.bob!, 'USD');
    expect((b.deductions as { code: string; amountCents: number }[]).find((d) => d.code.startsWith('LOAN'))?.amountCents).toBe(2000);
  });

  it('negative net pay stops the submit', async () => {
    const l = await emp.createLoan(W.hr, { employeeId: ids.dina, principalCents: 500000, instalmentCents: 400000, startMonth: '2026-11', reason: 'Big advance' });
    await fails(run.submitRun(W.hr, ids.nov!), 409, /negative net pay/);
    await prisma.loan.update({ where: { id: l.id }, data: { status: 'CANCELLED' } });
  });

  it('the Owner reopens an approved run before payment: the hand-over is cancelled and can be made again', async () => {
    await run.submitRun(W.hr, ids.nov!);
    await run.approveRun(W.owner, ids.nov!);
    const fr = (await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.nov } })).financeRunId!;
    await fails(run.reopenRun(W.hr, ids.nov!, { reason: 'Need to change something' }), 403);
    await fails(run.reopenRun(W.admin, ids.nov!, { reason: 'Need to change something' }), 403);
    await fails(run.reopenRun(W.owner, ids.nov!, { reason: 'no' }), 422);
    await run.reopenRun(W.owner, ids.nov!, { reason: 'Bob\'s allowance starts in December' });
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: fr } })).status).toBe('CANCELLED');
    expect((await prisma.hrPayrollRun.findUniqueOrThrow({ where: { id: ids.nov } })).status).toBe('DRAFT');
    await fails(fin.markPayrollPaid(W.bursar, fr, { lineIds: ['x'] }), 409, /reopened/);
    expect((await fin.listPayroll(W.bursar)).some((r) => r.id === fr)).toBe(false);
    expect((await fin.statutoryDue(W.bursar)).some((s) => s.period === '2026-11')).toBe(false);
    await run.submitRun(W.hr, ids.nov!);
    const again = await run.approveRun(W.owner, ids.nov!);
    expect(again.financeRunId).not.toBe(fr);
    const log = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityId: ids.nov, action: 'HR_REOPEN_RUN' } });
    expect(log).toHaveLength(1);
  });
});

describe('government-paid staff and the database', () => {
  it('never appear in a run, even if the service were bypassed', async () => {
    const draft = await prisma.hrPayrollRun.create({ data: { schoolId: A.schoolId, month: '2026-12', preparedById: W.hr.id } });
    await expect(t.pg.query(`INSERT INTO "HrPayrollLine" ("id","schoolId","runId","employeeId","currency","earnings","deductions","grossCents","taxableCents","payeCents","aidsLevyCents","nssaEmployeeCents","nssaEmployerCents","zimdefCents","netCents","updatedAt") VALUES ('l1','${A.schoolId}','${draft.id}','${ids.gov}','USD','[]','[]',1,1,0,0,0,0,0,1, now())`)).rejects.toThrow(/Government-paid/);
  });

  it('a person cannot be switched to government-paid while they are in an unpaid run', async () => {
    await fails(emp.updateEmployee(W.hr, ids.alice!, { employer: 'GOVERNMENT', ecNumber: 'EC999999', reason: 'Posted by the ministry' }), 409, /payroll run/);
  });
});

describe('payroll reports', () => {
  it('summary, statutory and wage bill, per currency, for people who may see pay only', async () => {
    const s = await reports.runHrReport(W.hr, 'payroll-summary', { year: 2026 });
    expect(s.rows.some((r) => r[1] === 'ZIG')).toBe(true);
    expect(s.rows.some((r) => r[1] === 'USD')).toBe(true);
    const st = await reports.runHrReport(W.hr, 'statutory', { year: 2026 });
    expect(st.rows.some((r) => r[2] === 'AIDS levy' && String(r[5]).startsWith('Due'))).toBe(true);
    const w = await reports.runHrReport(W.owner, 'wage-bill', { year: 2026 });
    expect(w.rows.length).toBeGreaterThan(0);
    await fails(reports.runHrReport(W.admin, 'wage-bill', {}), 403);
    await fails(reports.runHrReport(W.teacher2, 'statutory', {}), 403);
    expect((await reports.runHrReport(W.head, 'statutory', { year: 2026 })).rows.length).toBeGreaterThan(0); // the Head holds hr.payroll.view: the totals, not the payslips
  });
});

describe('rate changes and unpaid leave reach the run by themselves', () => {
  it('a new set of rates takes effect from its date, and needs confirming before a run in that month can be calculated', async () => {
    const r = await pset.saveStatutoryRates(W.hr, { effectiveFrom: '2026-12-01', aidsLevyBps: 300, nssaEmployeeBps: 450, nssaEmployerBps: 450, nssaCeilingUsdCents: 70000, nssaCeilingZigCents: null, nssaDeductibleBeforePaye: false, zimdefBps: 200 });
    const dec = await prisma.hrPayrollRun.findFirstOrThrow({ where: { schoolId: A.schoolId, month: '2026-12' } });
    await fails(run.recalculateRun(W.hr, dec.id), 409, /statutory rates in force for 2026-12 have not been confirmed/);
    await pset.confirmSetting(W.bursar, { kind: 'RATES', id: r.id });
    await run.recalculateRun(W.hr, dec.id);
    expect((await line(dec.id, ids.alice!, 'USD')).zimdefCents).toBe(1000); // 2% from December; it was 1% in October and November
    expect((await line(ids.oct!, ids.alice!, 'USD')).zimdefCents).toBe(500); // the paid run is a snapshot
  });

  it('approved unpaid leave takes its days off the basic pay', async () => {
    const special = await prisma.leaveType.findFirstOrThrow({ where: { schoolId: A.schoolId, code: 'SPECIAL' } });
    const req = await (await import('@/lib/hr/leave')).requestLeave(W.teacher2, { leaveTypeId: special.id, startDate: '2026-12-07', endDate: '2026-12-08', reason: 'Family matter' });
    await (await import('@/lib/hr/leave')).decideLeave(W.head, req.id, { decision: 'APPROVE' });
    const dec = await prisma.hrPayrollRun.findFirstOrThrow({ where: { schoolId: A.schoolId, month: '2026-12' } });
    await run.recalculateRun(W.hr, dec.id);
    const a = await line(dec.id, ids.alice!, 'USD');
    expect(a.grossCents).toBe(42857); // 2 of the 14 working days in December (the term ends on the 20th) taken off 500.00
    expect((a.earnings as { label: string }[])[0]!.label).toMatch(/less 2 unpaid days/);
  });
});
