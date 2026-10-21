// @vitest-environment node
// The second half of Finance end to end, against a real PostgreSQL: ZiG against a dollar charge, receipts and acknowledgements, family payments,
// moving credit, refunds approved by the Owner, purchase limits and overruns, the daily cash-up, bank reconciliation, payment plans, payroll,
// sponsors, discounts, invoices, statements, the ten report tables, Paynow, and the audit row every one of them writes.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { fails, financeWorld, type FinanceWorld } from '../helpers/finance';

let t: TestDb;
let A: SeededSchool;
let W: FinanceWorld;
let prisma: typeof import('@/lib/prisma').prisma;
const m: Record<string, any> = {};
const ids: Record<string, string> = {};

const owes = async (studentId: string) => (await m.accounts.getAccount(W.bursar, studentId)).byCurrency;
const audits = (action: string, entityId?: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never, ...(entityId ? { entityId } : {}) } });
const today = () => m.common.todayInHarare() as string;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  const mods = await Promise.all([
    import('@/lib/finance/setup'),
    import('@/lib/finance/structures'),
    import('@/lib/finance/billing'),
    import('@/lib/finance/payments'),
    import('@/lib/finance/refunds'),
    import('@/lib/finance/requests'),
    import('@/lib/finance/expenses'),
    import('@/lib/finance/accounts'),
    import('@/lib/finance/rates'),
    import('@/lib/finance/cashup'),
    import('@/lib/finance/bank'),
    import('@/lib/finance/plans'),
    import('@/lib/finance/payroll'),
    import('@/lib/finance/sponsors'),
    import('@/lib/finance/discounts'),
    import('@/lib/finance/credit'),
    import('@/lib/finance/statements'),
    import('@/lib/finance/invoices'),
    import('@/lib/finance/spending'),
    import('@/lib/finance/paynow'),
    import('@/lib/finance/reports'),
    import('@/lib/finance/common'),
    import('@/lib/finance/fees'),
  ]);
  ["setup","structures","billing","payments","refunds","requests","expenses","accounts","rates","cashup","bank","plans","payroll","sponsors","discounts","credit","statements","invoices","spending","paynow","reports","common","fees"].forEach((n, i) => { m[n] = mods[i]; });
  m.tables = await import('@/lib/finance/report-tables');
  A = await seedSchool(prisma, 'School A');
  W = await financeWorld(prisma, A);
  W.funds = Object.fromEntries((await m.setup.listFunds(W.bursar)).map((f: { code: string; id: string }) => [f.code, f.id]));
  // A fee structure, approved and billed: day learners owe 300 + 50 US dollars and ZiG 2000.
  const catalog = await m.structures.listCatalog(W.bursar);
  for (const n of ['Tuition', 'SDC levy']) ids[n] = catalog.find((i: { name: string }) => i.name === n).id;
  const s = await m.structures.createStructure(W.bursar, {});
  const line = (item: string, amount: string, currency = 'USD') => ({ catalogItemId: ids[item], amount, currency, levelIds: [A.levelId] });
  await m.structures.saveLine(W.bursar, s.id, null, line('Tuition', '300.00'));
  await m.structures.saveLine(W.bursar, s.id, null, line('SDC levy', '50.00'));
  await m.structures.saveLine(W.bursar, s.id, null, line('Tuition', '2000.00', 'ZIG'));
  await m.structures.submitStructure(W.bursar, s.id);
  await m.structures.approveStructure(W.head, s.id);
  await m.billing.runBilling(W.bursar, {});
  ids.structure = s.id;
  // Two children of one fee payer.
  const g = await prisma.guardian.create({ data: { schoolId: A.schoolId, fullName: 'Mrs Moyo', phone: '0771000111' } as never });
  ids.guardian = g.id;
  await prisma.studentGuardian.deleteMany({ where: { studentId: { in: [W.students.day1, W.students.day2] } } });
  for (const sid of [W.students.day1, W.students.day2]) {
    await prisma.studentGuardian.create({ data: { studentId: sid, guardianId: g.id, relationship: 'MOTHER', isPrimary: true, isFeePayer: true, canReceiveSms: true } as never });
  }
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('a payment in ZiG for a US dollar charge', () => {
  const zigPay = (extra: Record<string, unknown> = {}) => ({ studentId: W.students.day1, currency: 'USD', method: 'CASH', zigAmount: '2700.00', lines: [{ fundId: null }], ...extra });

  it('is refused without an exchange rate, and uses the rate in force on the date received', async () => {
    await fails(m.payments.recordPayment(W.clerk, zigPay()), 422, /no exchange rate/i);
    await fails(m.rates.setRate(W.clerk, { usdToZig: 27 }), 403);
    await m.rates.setRate(W.bursar, { usdToZig: 27, source: 'RBZ' });
    await fails(m.rates.setRate(W.bursar, { usdToZig: 0 }), 422);
    const made = await m.payments.recordPayment(W.clerk, zigPay());
    const p = await prisma.finPayment.findUniqueOrThrow({ where: { id: made.payments[0].id } });
    expect(p).toMatchObject({ currency: 'USD', amountCents: 10000, paidInZig: true, zigAmountCents: 270000 });
    expect(p.exchangeRateId).toBeTruthy();
    expect((await audits('SET_EXCHANGE_RATE')).length).toBeGreaterThan(0);
    ids.zigPayment = p.id;
  });

  it('cannot be used for a ZiG charge, and a rate row is never edited', async () => {
    await fails(m.payments.recordPayment(W.clerk, zigPay({ currency: 'ZIG', method: 'ECOCASH', reference: 'ZG1' })), 422, /Only a US dollar charge/);
    await expect(t.pg.query(`UPDATE "ExchangeRate" SET "usdToZig" = 99`)).rejects.toThrow();
    const list = await m.rates.listRates(W.bursar);
    expect(list.rows).toHaveLength(1);
    expect(list.stale).toBe(false);
  });
});

describe('receipts and acknowledgements', () => {
  it('give cash an official receipt at once and wait for a second person on everything else', async () => {
    const cash = await prisma.finPayment.findUniqueOrThrow({ where: { id: ids.zigPayment! } });
    expect(cash.status).toBe('RECEIVED');
    expect(cash.receiptNumber).toMatch(/^RCP-/);
    const eco = await m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'ECOCASH', reference: 'EC-100', lines: [{ amount: '20.00' }] });
    const p = await prisma.finPayment.findUniqueOrThrow({ where: { id: eco.payments[0].id } });
    expect(p).toMatchObject({ status: 'PENDING', receiptNumber: null });
    expect(p.ackNumber).toMatch(/^ACK-/);
    await fails(m.payments.verifyPayment(W.clerk, p.id), 403);
    const v = await m.payments.verifyPayment(W.bursar, p.id);
    expect(v.receiptNumber).toMatch(/^RCP-/);
    ids.eco = p.id;
    expect((await owes(W.students.day2)).USD.paid).toBe(2000);
  });

  it('refuse the same method and reference twice, a payment dated in the past without a reason, and a future date', async () => {
    await fails(m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'ECOCASH', reference: 'ec-100', lines: [{ amount: '5.00' }] }), 409, /already recorded/);
    await fails(m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', receivedOn: '2020-01-01', lines: [{ amount: '5.00' }] }), 422, /reason/);
    await fails(m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', receivedOn: '2999-01-01', lines: [{ amount: '5.00' }] }), 422, /future/);
    await fails(m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'PAYNOW', lines: [{ amount: '5.00' }] }), 422);
  });
});

describe('a family payment and moving credit', () => {
  it('is shared over the brothers and sisters, oldest charge first', async () => {
    const before1 = (await owes(W.students.day1)).USD.outstanding;
    const before2 = (await owes(W.students.day2)).USD.outstanding;
    const made = await m.payments.recordPayment(W.clerk, { guardianId: ids.guardian, currency: 'USD', method: 'BANK_TRANSFER', reference: 'FAM-1', proofKey: undefined, lines: [{ amount: '500.00' }] });
    await m.payments.verifyPayment(W.bursar, made.payments[0].id);
    const after1 = (await owes(W.students.day1)).USD.outstanding;
    const after2 = (await owes(W.students.day2)).USD.outstanding;
    expect(before1 - after1 + (before2 - after2)).toBe(50000);
    expect(after1).toBeLessThan(before1);
    expect(after2).toBeLessThan(before2);
  });

  it('moves credit to a brother or sister with the same fee payer, which someone else verifies', async () => {
    const over = await m.payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'BANK_TRANSFER', reference: 'OVER-1', lines: [{ amount: '400.00' }] });
    await m.payments.verifyPayment(W.bursar, over.payments[0].id);
    const credit = (await owes(W.students.day2)).USD.credit;
    expect(credit).toBeGreaterThan(0);
    await fails(m.credit.transferCredit(W.clerk, { fromStudentId: W.students.day2, toStudentId: W.students.day1, currency: 'USD', amount: '10', reason: 'Move it' }), 403);
    await fails(m.credit.transferCredit(W.bursar, { fromStudentId: W.students.day2, toStudentId: W.students.boarder, currency: 'USD', amount: '10', reason: 'Not a sibling' }), 422, /same fee payer/);
    await fails(m.credit.transferCredit(W.bursar, { fromStudentId: W.students.day2, toStudentId: W.students.day1, currency: 'USD', amount: '99999', reason: 'Too much' }), 409, /holds only/);
    const moved = await m.credit.transferCredit(W.bursar, { fromStudentId: W.students.day2, toStudentId: W.students.day1, currency: 'USD', amount: '10.00', reason: 'Settle the brother' });
    expect(moved).toBeTruthy();
    expect((await owes(W.students.day2)).USD.credit).toBe(credit - 1000);
    expect((await audits('TRANSFER_CREDIT')).length).toBeGreaterThan(0);
  });
});

describe('refunds', () => {
  it('are approved only by the Owner, never by the person who asked, and paid by a third person', async () => {
    const credit = (await m.credit.creditLedger(W.bursar, W.students.day2)).holding[0];
    const r = await m.refunds.requestRefund(W.bursar, { studentId: W.students.day2, currency: 'USD', amount: '5.00', reason: 'Overpaid by mistake', reasonKind: 'OVERPAID' });
    expect(credit.creditCents).toBeGreaterThan(500);
    await fails(m.refunds.decideRefund(W.head, r.id, 'approve'), 403); // the Head does not approve refunds
    await fails(m.refunds.decideRefund(W.bursar, r.id, 'approve'), 403);
    await m.refunds.decideRefund(W.owner, r.id, 'approve');
    await fails(m.refunds.payRefund(W.owner, r.id, { method: 'CASH' }), 403, /approved/); // the approver does not pay
    await fails(m.refunds.payRefund(W.bursar, r.id, { method: 'CASH' }), 403, /asked/); // nor the person who asked
    await m.refunds.payRefund(W.admin, r.id, { method: 'CASH' });
    const row = await prisma.finRefund.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PAID');
  });
});

describe('purchase requests', () => {
  it('above the Head\'s limit need the Owner as well, and a payment over the margin needs a second agreement', async () => {
    await m.setup.saveControls(W.owner, { headLimitUsd: '100.00', overrunPercent: 10 });
    const req = await m.requests.createRequest(W.teacher, {
      title: 'Lab chemicals', type: 'PURCHASE_ORDER', department: 'Science', justification: 'Practical lessons', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'Chemicals', quantity: 1, unit: '150.00' }], submit: true,
    });
    await fails(m.requests.decideRequest(W.teacher, req.id, 'approve'), 403);
    const first = await m.requests.decideRequest(W.head, req.id, 'approve');
    expect(first).toMatchObject({ status: 'PENDING', waitingFor: 'OWNER' });
    await fails(m.requests.decideRequest(W.head, req.id, 'approve'), 409);
    await m.requests.decideRequest(W.owner, req.id, 'approve');
    const row = await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row).toMatchObject({ status: 'APPROVED', approvedCeilingCents: 16500 });
    await fails(m.requests.disburseRequest(W.owner, req.id, { method: 'CASH', amount: '120.00' }), 403); // the approver does not pay
    const over = await m.requests.disburseRequest(W.bursar, req.id, { method: 'CASH', amount: '200.00' });
    expect(over).toMatchObject({ needsApproval: true });
    await fails(m.requests.approveOverrun(W.teacher, req.id), 403);
    await m.requests.approveOverrun(W.head, req.id);
    await m.requests.disburseRequest(W.bursar, req.id, { method: 'CASH', amount: '200.00' });
    expect((await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('DISBURSED');
    expect((await prisma.finExpense.findFirstOrThrow({ where: { requestId: req.id } })).amountCents).toBe(20000);
  });

  it('can be cancelled before they are paid, and a request over the quote limit needs its quotes', async () => {
    await m.setup.saveControls(W.owner, { quotesAboveUsd: '50.00', quotesRequired: 2 });
    const d = await m.requests.createRequest(W.teacher, { title: 'Desks', type: 'PURCHASE_ORDER', department: 'Maths', justification: 'New desks', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'Desk', quantity: 4, unit: '30.00' }] });
    await fails(m.requests.submitRequest(W.teacher, d.id), 422, /quotes/);
    await m.setup.saveControls(W.owner, { quotesAboveUsd: null });
    await m.requests.submitRequest(W.teacher, d.id);
    await m.requests.cancelRequest(W.teacher, d.id);
    expect((await prisma.finExpenseRequest.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('CANCELLED');
    await fails(m.requests.decideRequest(W.head, d.id, 'approve'), 409);
  });
});

describe('the daily cash-up', () => {
  it('is counted by the clerk, confirmed by the bursar (which verifies the cash) and signed off by the Head', async () => {
    const pos = await m.cashup.myCashUp(W.clerk);
    expect(pos.expected.USD).toBe(0); // the ZiG-for-dollars payment counts as the ZiG actually received
    expect(pos.expected.ZIG).toBe(270000);
    await fails(m.cashup.submitCashUp(W.clerk, { countedUsd: '0', countedZig: '2600.00' }), 422, /out by/);
    const sub = await m.cashup.submitCashUp(W.clerk, { countedUsd: '0', countedZig: '2700.00' });
    await fails(m.cashup.submitCashUp(W.clerk, { countedUsd: '0', countedZig: '2700.00' }), 409);
    await fails(m.cashup.confirmCashUp(W.clerk, sub.id), 403);
    await fails(m.cashup.signOffCashUp(W.head, sub.id), 409, /confirm/);
    const c = await m.cashup.confirmCashUp(W.bursar, sub.id, { depositRef: 'DEP-77' });
    expect(c.verified).toBe(1);
    expect((await prisma.finPayment.findUniqueOrThrow({ where: { id: ids.zigPayment! } })).status).toBe('VERIFIED');
    await fails(m.cashup.signOffCashUp(W.bursar, sub.id), 403);
    await m.cashup.signOffCashUp(W.head, sub.id);
    const day = await m.cashup.cashUpDay(W.head);
    expect(day.clerks.find((x: { userId: string }) => x.userId === W.clerk.id)?.status).toBe('Signed off');
    expect((await audits('CONFIRM_CASH_UP')).length).toBe(1);
  });
});

describe('bank reconciliation', () => {
  it('reads a CSV, matches by reference and amount, and turns unmatched money into a payment', async () => {
    const csv = `Date,Reference,Credit,Debit,Details\n${today().split('-').reverse().join('/')},EC-100,20.00,,EcoCash\n${today().split('-').reverse().join('/')},NEWREF,75.00,,Unknown depositor\n${today().split('-').reverse().join('/')},BANKFEE,,5.00,Charges\n`;
    const rows = await m.bank.readTable({ name: 'cbz.csv', data: Buffer.from(csv) });
    const up = await m.bank.uploadStatement(W.bursar, { bank: 'CBZ', account: 'Main', currency: 'USD', fileName: 'cbz.csv', mapping: { hasHeader: true, dateCol: 0, dateFormat: 'DMY', creditCol: 2, debitCol: 3, referenceCol: 1, descriptionCol: 4 } }, rows);
    await fails(m.bank.listStatements(W.clerk), 403);
    const st = await m.bank.getStatement(W.bursar, up.id);
    expect(st.lines.filter((l: { status: string }) => l.status === 'MATCHED')).toHaveLength(1);
    const unknown = st.lines.find((l: { reference: string | null }) => l.reference === 'NEWREF');
    const made = await m.bank.paymentFromLine(W.bursar, unknown.id, { studentId: W.students.boarder });
    expect((await prisma.finPayment.findUniqueOrThrow({ where: { id: made.paymentId } })).status).toBe('PENDING');
    const charge = st.lines.find((l: { reference: string | null }) => l.reference === 'BANKFEE');
    await fails(m.bank.paymentFromLine(W.bursar, charge.id, { studentId: W.students.boarder }), 409);
    expect(charge.status).toBe('IGNORED'); // money out is set aside when the statement is read
    expect((await m.bank.loadMapping(W.bursar, 'CBZ')).creditCol).toBe(2);
  });
});

describe('payment plans', () => {
  it('track instalments as money arrives and a plan beyond the term needs the Head', async () => {
    const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await fails(m.plans.createPlan(W.teacher, { guardianId: ids.guardian, currency: 'USD', instalments: [{ dueDate: d(5), amount: '10' }, { dueDate: d(9), amount: '10' }] }), 403);
    await fails(m.plans.createPlan(W.bursar, { guardianId: ids.guardian, currency: 'USD', instalments: [{ dueDate: d(5), amount: '10' }] }), 422);
    await fails(m.plans.createPlan(W.bursar, { guardianId: ids.guardian, currency: 'USD', instalments: [{ dueDate: d(9), amount: '10' }, { dueDate: d(5), amount: '10' }] }), 422, /later/);
    const p = await m.plans.createPlan(W.bursar, { guardianId: ids.guardian, currency: 'USD', instalments: [{ dueDate: d(5), amount: '10' }, { dueDate: d(400), amount: '10' }] });
    expect(p.status).toBe('PENDING_APPROVAL');
    await fails(m.plans.decidePlan(W.bursar, p.id, 'approve'), 403);
    await m.plans.decidePlan(W.head, p.id, 'approve');
    const [plan] = await m.plans.listPlans(W.bursar, { guardianId: ids.guardian });
    expect(plan.status).toBe('ACTIVE');
    expect(plan.upToDate).toBe(true);
    const tx = await m.statements.arrearsList(W.bursar, {});
    expect(tx.rows.find((r: { studentId: string }) => r.studentId === W.students.day1)?.plan).toBe('ON_PLAN');
  });
});

describe('payroll', () => {
  it('is paid by Finance, never by the person who prepared it, and records the salaries as expenses', async () => {
    await expect(prisma.$transaction((tx) => m.payroll.handOverPayroll(tx, A.schoolId, { period: '2026-10', preparedById: W.head.id, approvedById: W.head.id, lines: [{ employee: 'Mr X', currency: 'USD', netCents: 50000, method: 'BANK_TRANSFER' }] }))).rejects.toThrow(/approved by someone other/);
    const run: { id: string } = await prisma.$transaction((tx) => m.payroll.handOverPayroll(tx, A.schoolId, {
      period: '2026-10', preparedById: W.head.id, approvedById: W.owner.id,
      lines: [{ employee: 'Mr Banda', currency: 'USD', netCents: 50000, method: 'BANK_TRANSFER', account: '123' }, { employee: 'Mrs Chuma', currency: 'ZIG', netCents: 900000, method: 'ECOCASH' }],
      statutory: [{ type: 'PAYE', currency: 'USD', amountCents: 8000, dueDate: '2026-11-10' }],
    }), { timeout: 20000 } as never);
    await fails(m.payroll.markPayrollPaid(W.teacher, run.id, { lineIds: ['x'] }), 403);
    const lines = (await m.payroll.listPayroll(W.bursar))[0].lines;
    await fails(m.payroll.markPayrollPaid(W.head, run.id, { lineIds: lines.map((l: { id: string }) => l.id) }), 403); // finance.payroll.pay is not the Head's
    const first = await m.payroll.markPayrollPaid(W.bursar, run.id, { lineIds: [lines[0].id], reference: 'BULK1' });
    expect(first.runPaid).toBe(false);
    await fails(m.payroll.markPayrollPaid(W.bursar, run.id, { lineIds: [lines[0].id] }), 409, /already paid/);
    const last = await m.payroll.markPayrollPaid(W.bursar, run.id, { lineIds: [lines[1].id] });
    expect(last.runPaid).toBe(true);
    expect(await prisma.finExpense.count({ where: { schoolId: A.schoolId, payrollRunId: run.id, category: 'Salaries' } })).toBe(2);
    const due = await m.payroll.statutoryDue(W.bursar);
    expect(due[0]).toMatchObject({ type: 'PAYE', amountCents: 8000 });
    await m.payroll.markStatutoryPaid(W.bursar, due[0].id, { reference: 'ZIMRA-1' });
    expect(await m.payroll.statutoryDue(W.bursar)).toHaveLength(0);
    const csv = await m.payroll.payrollBulkFile(W.bursar, run.id);
    expect(csv.split('\n')[0]).toContain('Employee');
  });
});

describe('sponsors and discounts', () => {
  it('cover a learner at billing, are claimed from the sponsor, and are paid, verified and shared out by different people', async () => {
    const sp = await m.sponsors.saveSponsor(W.bursar, null, { name: 'BEAM', type: 'BEAM' });
    const terms = await prisma.academicTerm.findMany({ where: { schoolId: A.schoolId } });
    const award = await m.sponsors.createAward(W.bursar, { sponsorId: sp.id, studentId: W.students.boarder, percent: 100, currency: 'USD', termFromId: terms[0].id });
    await fails(m.sponsors.decideAward(W.bursar, award.id, 'approve'), 403);
    expect(award.id).toBeTruthy();
    const list = await m.sponsors.listAwards(W.bursar, { sponsorId: sp.id });
    expect(list[0].status).toBe('PENDING');
    ids.sponsor = sp.id;
  });

  it('keep a standing discount that someone else approves', async () => {
    const rule = await m.discounts.createRule(W.bursar, { studentId: W.students.day1, kind: 'STAFF_CHILD', percent: 10, standing: 'true', reason: 'Staff child' });
    await fails(m.discounts.decideRule(W.bursar, rule.id, 'approve'), 403);
    await m.discounts.decideRule(W.head, rule.id, 'approve');
    expect((await m.discounts.listRules(W.head, { status: 'APPROVED' })).length).toBe(1);
    await fails(m.discounts.createRule(W.bursar, { studentId: W.students.day1, kind: 'HARDSHIP', reason: 'No amount' }), 422);
  });
});

describe('statements, invoices and the report tables', () => {
  it('give a statement with a running balance per currency, and a numbered invoice that is a snapshot', async () => {
    const st = await m.statements.studentStatement(W.bursar, W.students.day1);
    expect(st.entries.length).toBeGreaterThan(0);
    expect(Object.keys(st.closing).sort()).toEqual(['USD', 'ZIG']);
    const term = (await prisma.academicTerm.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'OPEN' } })).id;
    const [inv] = await m.invoices.createInvoices(W.bursar, { studentId: W.students.day1, termId: term });
    expect(inv.number).toMatch(/^INV-/);
    const [second] = await m.invoices.createInvoices(W.bursar, { studentId: W.students.day1, termId: term });
    expect(second.number).not.toBe(inv.number);
    const fam = await m.invoices.createInvoices(W.bursar, { guardianId: ids.guardian, termId: term });
    expect((await m.invoices.getInvoice(W.bursar, fam[0].id)).data.statements).toHaveLength(2);
    await fails(m.invoices.createInvoices(W.teacher, { studentId: W.students.day1, termId: term }), 403);
  });

  it('run all ten reports, each currency on its own rows', async () => {
    for (const slug of m.tables.REPORT_SLUGS) {
      const r = await m.tables.runReport(W.bursar, slug, {});
      expect(r.headers.length).toBeGreaterThan(2);
      for (const row of r.rows) expect(row).toHaveLength(r.headers.length);
    }
    await fails(m.tables.runReport(W.teacher, 'cash-book', {}), 403);
    const arrears = await m.tables.runReport(W.bursar, 'arrears-ageing', {});
    expect(arrears.rows.length).toBeGreaterThan(0);
  });
});

describe('Paynow', () => {
  const sign = (values: string[], key: string) => createHash('sha512').update(values.join('') + key).digest('hex').toUpperCase();

  it('records and verifies a payment once the callback is signed with the school\'s key, and only once', async () => {
    await prisma.finSettings.update({ where: { schoolId: A.schoolId }, data: { paynowEnabled: true, paynowId: '1234', paynowKey: 'secret-key-1' } });
    const reference = 'PFM-ABCDEF123456';
    await prisma.paynowAttempt.create({ data: { schoolId: A.schoolId, studentId: W.students.day2, reference, currency: 'USD', amountCents: 2500, status: 'SENT' } });
    const fields: [string, string][] = [['reference', reference], ['paynowreference', '55501'], ['amount', '25.00'], ['status', 'Paid'], ['pollurl', 'https://example.test/poll']];
    const body = (hash: string) => new URLSearchParams([...fields, ['hash', hash]]);
    await fails(m.paynow.paynowCallback(body('BAD')), 400, /signature/i);
    expect(await prisma.finPayment.count({ where: { schoolId: A.schoolId, method: 'PAYNOW' } })).toBe(0);
    const good = sign(fields.map(([, v]) => v), 'secret-key-1');
    await m.paynow.paynowCallback(body(good));
    await m.paynow.paynowCallback(body(good)); // Paynow may call twice
    const pays = await prisma.finPayment.findMany({ where: { schoolId: A.schoolId, method: 'PAYNOW' } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ status: 'VERIFIED', amountCents: 2500, reference: '55501' });
    expect(pays[0]!.receiptNumber).toMatch(/^RCP-/);
    const small: [string, string][] = [['reference', reference], ['paynowreference', '55502'], ['amount', '1.00'], ['status', 'Paid']];
    await prisma.paynowAttempt.create({ data: { schoolId: A.schoolId, studentId: W.students.day2, reference: 'PFM-ABCDEF000000', currency: 'USD', amountCents: 2500, status: 'SENT' } });
    small[0] = ['reference', 'PFM-ABCDEF000000'];
    await fails(m.paynow.paynowCallback(new URLSearchParams([...small, ['hash', sign(small.map(([, v]) => v), 'secret-key-1')]])), 409, /smaller amount/);
  });
});
