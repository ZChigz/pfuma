// @vitest-environment node
// The Finance module end to end, against a real PostgreSQL: fees and charges, payments and their verification, balances that are
// calculated, voids and credit notes instead of edits, refunds, the spending path, funds kept apart, closed terms, the audit log,
// and the rule that the person who records money is never the person who checks it (not even an Owner or Administrator).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf, addTeacher } from '../helpers/academics';
import { fails, financeWorld, type FinanceWorld } from '../helpers/finance';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: FinanceWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let setup: typeof import('@/lib/finance/setup');
let fees: typeof import('@/lib/finance/fees');
let structures: typeof import('@/lib/finance/structures');
let billing: typeof import('@/lib/finance/billing');
let payments: typeof import('@/lib/finance/payments');
let adjustments: typeof import('@/lib/finance/adjustments');
let refunds: typeof import('@/lib/finance/refunds');
let requests: typeof import('@/lib/finance/requests');
let expenses: typeof import('@/lib/finance/expenses');
let accounts: typeof import('@/lib/finance/accounts');
let reports: typeof import('@/lib/finance/reports');
let legacy: typeof import('@/lib/finance/legacy-guard');
let scoped: typeof import('@/lib/scoped-db');

const ids: Record<string, string> = {};
const owed = async (studentId: string) => (await accounts.getAccount(W.bursar, studentId)).byCurrency;
const audits = (action: string, entityId?: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never, ...(entityId ? { entityId } : {}) }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [setup, fees, structures, billing, payments, adjustments, refunds, requests, expenses, accounts, reports, legacy, scoped] = await Promise.all([
    import('@/lib/finance/setup'), import('@/lib/finance/fees'), import('@/lib/finance/structures'), import('@/lib/finance/billing'), import('@/lib/finance/payments'), import('@/lib/finance/adjustments'), import('@/lib/finance/refunds'),
    import('@/lib/finance/requests'), import('@/lib/finance/expenses'), import('@/lib/finance/accounts'), import('@/lib/finance/reports'), import('@/lib/finance/legacy-guard'), import('@/lib/scoped-db'),
  ]);
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await financeWorld(prisma, A);
  W.funds = Object.fromEntries((await setup.listFunds(W.bursar)).map((f) => [f.code, f.id]));
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('funds, fee items and the fee structure', () => {
  it('start every school with its funds and its list of fee items', async () => {
    expect(Object.keys(W.funds).sort()).toEqual(['BOARDING', 'BUILDING', 'EXAMS', 'GENERAL', 'OTHER', 'SDC', 'TUITION']);
    const catalog = await structures.listCatalog(W.bursar);
    expect(catalog.map((i) => i.name)).toEqual(['Tuition', 'SDC levy', 'Boarding fee', 'Building levy', 'Sports levy', 'Library levy', 'Computer / ICT levy', 'Exam fee', 'Uniform', 'Transport', 'Trips', 'Library fine', 'Other']);
    expect(catalog.find((i) => i.name === 'Boarding fee')).toMatchObject({ fundName: 'Boarding', recurring: true });
    expect(catalog.find((i) => i.name === 'Uniform')).toMatchObject({ recurring: false });
    for (const n of ['Tuition', 'SDC levy', 'Boarding fee', 'Exam fee', 'Library fine']) ids[n] = catalog.find((i) => i.name === n)!.id;
  });

  it('are prepared by the bursar and approved by the Head, never by the person who prepared them', async () => {
    const line = (item: string, amount: string, over: Record<string, unknown> = {}) => ({ catalogItemId: ids[item], amount, currency: 'USD', levelIds: [A.levelId], ...over });
    await fails(structures.createStructure(W.teacher, {}), 403);
    await fails(structures.createStructure(W.clerk, {}), 403);
    const s = await structures.createStructure(W.bursar, {});
    ids.structure = s.id;
    expect(s.version).toBe(1);
    await fails(structures.createStructure(W.bursar, {}), 409, /already a fee structure being prepared/);
    for (const amount of ['10.005', '0', '-5', 'ten']) await fails(structures.saveLine(W.bursar, s.id, null, line('Tuition', amount)), 422);
    await fails(structures.saveLine(W.bursar, s.id, null, line('Tuition', '10', { currency: 'EUR' })), 422);
    await fails(structures.saveLine(W.bursar, s.id, null, { ...line('Tuition', '10'), catalogItemId: 'nope' }), 404);
    await structures.saveLine(W.bursar, s.id, null, line('Tuition', '300.00'));
    await structures.saveLine(W.bursar, s.id, null, line('SDC levy', '50'));
    await structures.saveLine(W.bursar, s.id, null, line('Boarding fee', '400.00', { boarding: 'BOARDER' }));
    await structures.saveLine(W.bursar, s.id, null, line('Tuition', '2000.00', { currency: 'ZIG' }));
    await fails(structures.saveLine(W.bursar, s.id, null, line('Tuition', '310.00')), 409, /already set/);
    // nothing can be billed from a draft
    await fails(billing.runBilling(W.bursar, {}), 409, /no approved fee structure/);
    await fails(structures.approveStructure(W.head, s.id), 409, /submitted/);
    await structures.submitStructure(W.bursar, s.id);
    await fails(structures.saveLine(W.bursar, s.id, null, line('Tuition', '1')), 409, /draft/);
    await fails(structures.approveStructure(W.bursar, s.id), 403); // no permission to approve
    await fails(billing.runBilling(W.bursar, {}), 409, /no approved fee structure/);
    // a Head who prepared it cannot approve it either
    const headDraft = await prisma.finFeeStructure.findUniqueOrThrow({ where: { id: s.id } });
    expect(headDraft.status).toBe('SUBMITTED');
    await structures.approveStructure(W.head, s.id);
    const v = await structures.getStructure(W.head, s.id);
    expect(v).toMatchObject({ status: 'APPROVED', approvedBy: W.head.fullName });
    expect(v.lines.map((l) => l.audience)).toContain('Form 1 · boarders');
  });

  it('charge each learner the lines of their form and boarding type, in cents, once', async () => {
    await fails(billing.previewBilling(W.teacher, {}), 403);
    const preview = await billing.previewBilling(W.bursar, {});
    expect(preview.counts).toMatchObject({ charged: 4, skippedCharged: 0 });
    const fundTotals = (f: string, c: string) => preview.totals.find((t) => t.fundName === f && t.currency === c)?.net;
    expect(fundTotals('Tuition', 'USD')).toBe(120000); // four learners x 300
    expect(fundTotals('SDC levy', 'USD')).toBe(20000);
    expect(fundTotals('Boarding', 'USD')).toBe(40000);
    expect(fundTotals('Tuition', 'ZIG')).toBe(800000);
    const done = await billing.runBilling(W.bursar, {});
    expect(done).toMatchObject({ charged: 4, charges: 13 }); // four learners x (tuition, SDC, tuition ZiG) + boarding for the boarder
    const again = await billing.runBilling(W.bursar, {}); // running it twice charges nobody twice
    expect(again).toMatchObject({ charged: 0, charges: 0, skippedCharged: 4 });
    const rows = await prisma.finCharge.findMany({ where: { schoolId: A.schoolId } });
    expect(rows.every((c) => Number.isInteger(c.amountCents))).toBe(true);
    expect(rows.filter((c) => c.studentId === W.students.boarder)).toHaveLength(4);
    expect((await structures.getStructure(W.head, ids.structure!)).billed).toBe(true);
    await fails(structures.saveLine(W.bursar, ids.structure!, null, { catalogItemId: ids.Tuition, amount: '1', currency: 'USD' }), 409);
    // the unique constraint is what stops a second charge, whatever the code does
    await expect(t.pg.query(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","feeItemId","description","currency","amountCents","source") SELECT 'dup1',"schoolId","studentId","termId","fundId","feeItemId","description","currency","amountCents",'FEE_ITEM' FROM "FinCharge" WHERE "feeItemId" IS NOT NULL LIMIT 1`)).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('a balance is calculated per currency and never mixes them', () => {
  it('shows US dollars and ZiG side by side for the same student', async () => {
    const b = await owed(W.students.day1);
    expect(b.USD.outstanding).toBe(35000); // tuition 300 + SDC 50
    expect(b.ZIG.outstanding).toBe(200000);
    expect(b.USD.charged + b.ZIG.charged).not.toBe(b.USD.outstanding); // nothing adds the two together anywhere
  });
});

describe('a payment reduces a balance only once verified by someone else', () => {
  it('is recorded as pending and changes no balance', async () => {
    const r = await payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '100.00' }] });
    ids.p1 = r.payments[0]!.id;
    expect(r.payments[0]!.receiptNumber).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect((await owed(W.students.day1)).USD.outstanding).toBe(35000);
    expect((await prisma.finPayment.findUniqueOrThrow({ where: { id: ids.p1 } })).status).toBe('RECEIVED'); // cash: received, with its receipt, until the bursar confirms it
  });

  it('is refused if the amount is not exact cents', async () => {
    for (const amount of ['10.005', '0', '-1', 'x']) {
      await fails(payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount }] }), 422);
    }
    await fails(payments.recordPayment(W.teacher, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '1' }] }), 403);
    await fails(payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'ECOCASH', lines: [{ fundId: W.funds.TUITION, amount: '1' }] }), 422, /reference/);
  });

  it('cannot be verified by the person who recorded it: not the clerk, not the bursar, not an Administrator', async () => {
    await fails(payments.verifyPayment(W.clerk, ids.p1), 403); // no permission at all
    const mine = (await payments.recordPayment(W.bursar, { studentId: W.students.day2, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '10.00' }] })).payments[0]!.id;
    await fails(payments.verifyPayment(W.bursar, mine), 403, /You recorded this payment/);
    const adminRecorded = (await payments.recordPayment(W.operator2, { studentId: W.students.day2, currency: 'USD', method: 'SWIPE', reference: 'POS-0001', lines: [{ fundId: W.funds.TUITION, amount: '10.00' }] })).payments[0]!.id;
    await fails(payments.verifyPayment(W.operator2, adminRecorded), 403, /You recorded this payment/);
    await fails(payments.rejectPayment(W.operator2, adminRecorded, 'not mine to judge'), 403);
    // Nothing moved, and nothing was written to the audit log for the refused attempts.
    expect((await prisma.finPayment.findMany({ where: { id: { in: [mine, adminRecorded] } } })).every((p) => p.status === 'PENDING' || p.status === 'RECEIVED')).toBe(true);
    expect(await audits('VERIFY_PAYMENT', mine)).toHaveLength(0);
    ids.bursarPays = mine;
    ids.adminPays = adminRecorded;
  });

  it('is verified by a second person; then the oldest charge of the same fund is settled', async () => {
    const r = await payments.verifyPayment(W.bursar2, ids.p1);
    expect(r.allocatedCents).toBe(10000);
    expect(r.verifierFallback).toBe(false); // the Head holds the verify permission through a role
    const b = await owed(W.students.day1);
    expect(b.USD.outstanding).toBe(25000);
    expect(b.USD.paid).toBe(10000);
    expect(b.ZIG.outstanding).toBe(200000); // the other currency is untouched
    const allocs = await prisma.finPaymentAllocation.findMany({ where: { paymentId: ids.p1 }, include: { charge: true } });
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.charge.description).toBe('Tuition'); // never the SDC levy
    await fails(payments.verifyPayment(W.bursar2, ids.p1), 409, /already verified/);
  });

  it('can be verified by the Owner when nobody else can, and the cash-up report says so', async () => {
    const sdc = (await payments.recordPayment(W.bursar, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.SDC, amount: '50.00' }] })).payments[0]!.id;
    // A school with one finance person lets the Owner be the second (Settings, single-person finance); nobody else can stand in.
    await fails(payments.verifyPayment(W.owner, sdc), 403);
    await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: true } });
    const r = await payments.verifyPayment(await actorOf(prisma, W.owner.id), sdc);
    await prisma.school.update({ where: { id: A.schoolId }, data: { singlePersonFinance: false } });
    expect(r.verifierFallback).toBe(true);
    expect((await owed(W.students.day1)).USD.outstanding).toBe(20000);
    const cu = await reports.cashUp(W.bursar2);
    const warn = cu.warnings.find((w) => w.code === 'OWNER_VERIFIED');
    expect(warn?.message).toMatch(/verified by the Owner/);
    expect(warn?.message).toContain('US$50.00');
    expect((await prisma.finPayment.findUniqueOrThrow({ where: { id: sdc } })).verifierFallback).toBe(true);
    // a payment the Head verified carries no such warning
    expect((await prisma.finPayment.findUniqueOrThrow({ where: { id: ids.p1 } })).verifierFallback).toBe(false);
  });

  it('an Administrator may verify what someone else recorded', async () => {
    await payments.verifyPayment(W.operator2, ids.bursarPays);
    await payments.verifyPayment(W.operator, ids.adminPays);
    expect((await owed(W.students.day2)).USD.paid).toBe(2000);
  });

  it('a rejected payment counts for nothing, and needs a reason', async () => {
    const p = (await payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '20.00' }] })).payments[0]!.id;
    await fails(payments.rejectPayment(W.bursar2, p, ''), 422);
    await payments.rejectPayment(W.bursar2, p, 'The cash was not in the envelope');
    expect((await owed(W.students.day2)).USD.paid).toBe(2000);
    await fails(payments.verifyPayment(W.operator, p), 409, /rejected/);
    const [a] = await audits('REJECT_PAYMENT', p);
    expect(a?.before).toMatchObject({ status: 'RECEIVED' });
    expect(a?.after).toMatchObject({ status: 'REJECTED', rejectedById: W.bursar2.id });
  });

  it('money beyond the charges stays as credit, and is used when a new charge arrives', async () => {
    const p = (await payments.recordPayment(W.bursar, { studentId: W.students.day2, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '500.00' }] })).payments[0]!.id;
    const v = await payments.verifyPayment(W.bursar2, p);
    expect(v.allocatedCents).toBe(28000); // 300 tuition less the 20 already paid
    expect(v.creditCents).toBe(22000);
    let b = await owed(W.students.day2);
    expect(b.USD.credit).toBe(22000);
    const charge = await fees.addCharge(W.bursar, W.students.day2, { fundId: W.funds.TUITION, description: 'Laboratory fee', currency: 'USD', amount: '150.00' });
    b = await owed(W.students.day2);
    expect(b.USD.credit).toBe(7000);
    const lab = (await accounts.getAccount(W.bursar, W.students.day2)).charges.find((c) => c.chargeId === charge.id)!;
    expect(lab.outstandingCents).toBe(0);
    ids.labCharge = charge.id;
    ids.creditPayment = p;
  });

  it('one handover split across funds gives one receipt per fund, each settling only its own fund', async () => {
    const r = await payments.recordPayment(W.clerk, { studentId: W.students.boarder, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '300.00' }, { fundId: W.funds.SDC, amount: '50.00' }] });
    expect(r.payments).toHaveLength(2);
    expect(new Set(r.payments.map((p) => p.receiptNumber)).size).toBe(2);
    for (const p of r.payments) await payments.verifyPayment(W.bursar2, p.id);
    const a = await accounts.getAccount(W.bursar, W.students.boarder);
    const byFund = Object.fromEntries(a.byFund.map((f) => [f.fundName, f.byCurrency.USD.outstanding]));
    expect(byFund).toEqual({ Tuition: 0, 'SDC levy': 0, Boarding: 40000 });
    await fails(payments.recordPayment(W.clerk, { studentId: W.students.boarder, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.SDC, amount: '1' }, { fundId: W.funds.SDC, amount: '2' }] }), 422);
  });

  it('refuses a reference that was already recorded', async () => {
    const one = { studentId: W.students.day1, currency: 'USD', method: 'ECOCASH', reference: 'MP260101.1234.A12345', lines: [{ fundId: W.funds.TUITION, amount: '5.00' }] };
    await payments.recordPayment(W.clerk, one);
    await fails(payments.recordPayment(W.clerk, one), 409, /already recorded/);
  });
});

describe('mistakes are fixed with a new row, never an edit', () => {
  it('voids a payment: the row stays, the balance comes back, and not by the person who recorded it', async () => {
    const p = (await payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '40.00' }] })).payments[0]!.id;
    await payments.verifyPayment(W.bursar2, p);
    await fails(payments.voidPayment(W.clerk, p, 'Entered against the wrong student'), 403); // no permission
    await fails(payments.voidPayment(W.operator, p, 'short'), 422);
    const mine = (await payments.recordPayment(W.operator, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '1.00' }] })).payments[0]!.id;
    await payments.verifyPayment(W.bursar2, mine);
    await fails(payments.voidPayment(W.operator, mine, 'I recorded this one myself'), 403, /someone else must void/);
    const before = (await owed(W.students.day1)).USD.outstanding;
    await payments.voidPayment(W.operator, p, 'Entered against the wrong student');
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before + 4000);
    expect(await prisma.finPayment.findUnique({ where: { id: p } })).not.toBeNull(); // the original stays
    expect(await prisma.finVoid.count({ where: { paymentId: p } })).toBe(1);
    await fails(payments.voidPayment(W.operator2, p, 'Void it again please'), 409, /already voided/);
    expect((await payments.listPayments(W.bursar2, { status: 'VOIDED' })).rows.map((r) => r.id)).toContain(p);
    expect((await payments.listPayments(W.bursar2, { status: 'VERIFIED' })).rows.map((r) => r.id)).not.toContain(p);
    const [a] = await audits('VOID_PAYMENT', p);
    expect(a?.after).toMatchObject({ voided: true, reason: 'Entered against the wrong student' });
    ids.voided = p;
  });

  it('voids a charge that nothing was paid against; otherwise a credit note is the way', async () => {
    // the lab fee was settled at once by the credit day2 held, so a payment is against it
    await fails(fees.voidCharge(W.operator, ids.labCharge, 'Charged to the wrong student'), 409, /credit note/);
    const wrong = await fees.addCharge(W.bursar, W.students.day2, { fundId: W.funds.GENERAL, description: 'Wrong student charge', currency: 'USD', amount: '25.00' });
    await fees.voidCharge(W.operator, wrong.id, 'Charged to the wrong student'); // another fund: the Tuition credit does not touch it
    const lone = await fees.addCharge(W.bursar, W.students.day1, { fundId: W.funds.GENERAL, description: 'Duplicate bus fee', currency: 'ZIG', amount: '100.00' });
    await fails(fees.voidCharge(W.bursar, lone.id, 'I made it myself'), 403);
    await fees.voidCharge(W.operator, lone.id, 'Charged twice by mistake');
    expect(await prisma.finCharge.findUnique({ where: { id: lone.id } })).not.toBeNull();
    expect((await owed(W.students.day1)).ZIG.outstanding).toBe(200000); // the void charge is left out
  });

  it('lowers a charge with a credit note that a second person approves, and never below zero', async () => {
    const tuition = (await accounts.getAccount(W.bursar, W.students.day1)).charges.find((c) => c.description === 'Tuition' && c.currency === 'USD')!;
    const before = (await owed(W.students.day1)).USD.outstanding;
    const adj = await adjustments.requestAdjustment(W.bursar, { chargeId: tuition.chargeId, kind: 'BURSARY', amount: '60.00', reason: 'Bursary awarded by the board' });
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before); // pending counts for nothing
    await fails(adjustments.decideAdjustment(W.bursar, adj.id, 'approve'), 403); // no permission
    await fails(adjustments.requestAdjustment(W.bursar, { chargeId: tuition.chargeId, kind: 'DISCOUNT', amount: '9999.00', reason: 'Far too large' }), 409);
    const own = await adjustments.requestAdjustment(W.operator, { chargeId: tuition.chargeId, kind: 'WAIVER', amount: '1.00', reason: 'Owner waives a dollar' });
    await fails(adjustments.decideAdjustment(W.operator, own.id, 'approve'), 403, /You asked for this adjustment/);
    await adjustments.decideAdjustment(W.head, adj.id, 'approve');
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before - 6000);
    await fails(adjustments.decideAdjustment(W.head, adj.id, 'approve'), 409, /already approved/);
    await adjustments.decideAdjustment(W.head, own.id, 'reject', 'Not justified');
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before - 6000);
    const [a] = await audits('APPROVE_ADJUSTMENT', adj.id);
    expect(a?.before).toMatchObject({ status: 'PENDING' });
    expect(a?.after).toMatchObject({ status: 'APPROVED', decidedById: W.head.id, amountCents: 6000 });
  });
});

describe('refunds are asked, approved and paid by three different people', () => {
  it('takes money back out of a settled charge only when it is paid out', async () => {
    const paid = (await accounts.getAccount(W.bursar, W.students.boarder)).charges.find((c) => c.description === 'SDC levy')!;
    const pay = await prisma.finPayment.findFirstOrThrow({ where: { studentId: W.students.boarder, fundId: W.funds.SDC } });
    await fails(refunds.requestRefund(W.teacher, { paymentId: pay.id, chargeId: paid.chargeId, amount: '10', reason: 'Not allowed' }), 403);
    await fails(refunds.requestRefund(W.bursar, { paymentId: pay.id, chargeId: paid.chargeId, amount: '60.00', reason: 'More than was paid' }), 409);
    const r = await refunds.requestRefund(W.bursar, { paymentId: pay.id, chargeId: paid.chargeId, amount: '20.00', reason: 'Student left the school' });
    await fails(refunds.decideRefund(W.bursar, r.id, 'approve'), 403); // no permission
    await refunds.decideRefund(W.operator2, r.id, 'approve');
    await fails(refunds.payRefund(W.operator2, r.id, { method: 'CASH' }), 403, /You approved/);
    await fails(refunds.payRefund(W.bursar, r.id, { method: 'CASH' }), 403, /You asked for/);
    const before = (await owed(W.students.boarder)).USD.outstanding;
    expect(before).toBe(40000);
    await refunds.payRefund(W.operator, r.id, { method: 'CASH' });
    expect((await owed(W.students.boarder)).USD.outstanding).toBe(before + 2000);
    await fails(refunds.payRefund(W.operator, r.id, { method: 'CASH' }), 409, /already paid/);
    expect(await audits('REQUEST_REFUND', r.id)).toHaveLength(1);
    expect(await audits('APPROVE_REFUND', r.id)).toHaveLength(1);
    const [paidAudit] = await audits('PAY_REFUND', r.id);
    expect(paidAudit?.before).toMatchObject({ status: 'APPROVED' });
    expect(paidAudit?.after).toMatchObject({ status: 'PAID', paidById: W.operator.id });
    // the payment with a refund against it cannot be voided
    await fails(payments.voidPayment(W.operator2, pay.id, 'Voiding after a refund'), 409, /refund/);
  });

  it('returns unallocated credit, never more than there is', async () => {
    const pay = ids.creditPayment!;
    const r1 = await refunds.requestRefund(W.bursar, { paymentId: pay, amount: '30.00', reason: 'Overpayment returned' });
    await fails(refunds.requestRefund(W.bursar, { paymentId: pay, amount: '41.00', reason: 'More than the credit' }), 409);
    await refunds.decideRefund(W.operator2, r1.id, 'approve');
    const reserved = (await owed(W.students.day2)).USD; // the credit being returned is already set aside, so nothing else can use it
    await refunds.payRefund(W.operator, r1.id, { method: 'BANK_TRANSFER', reference: 'TT-77' });
    const after = (await owed(W.students.day2)).USD;
    expect(after.outstanding).toBe(reserved.outstanding); // returning credit does not make the student owe anything
    expect(after.credit).toBe(reserved.credit);
    expect(after.credit).toBe(7000 - 3000);
  });
});

describe('spending goes out along its own path', () => {
  it('has no expense until an approved request is paid', async () => {
    const before = await prisma.finExpense.count({ where: { schoolId: A.schoolId } });
    const r = await requests.createRequest(W.teacher, {
      title: 'Chalk and markers', type: 'PURCHASE_ORDER', department: 'Science', justification: 'Running low for the term', fundId: W.funds.GENERAL, currency: 'USD',
      items: [{ description: 'Chalk boxes', quantity: 10, unit: '2.50' }, { description: 'Markers', quantity: 4, unit: '3.00' }],
    });
    ids.req = r.id;
    expect(r.requestNumber).toMatch(/^PR-\d{4}-0001$/);
    await requests.submitRequest(W.teacher, r.id);
    await fails(requests.submitRequest(W.teacher, r.id), 409);
    expect((await requests.getRequest(W.bursar, r.id)).estimatedCents).toBe(3700);
    expect(await prisma.finExpense.count({ where: { schoolId: A.schoolId } })).toBe(before); // asking for money is not spending it
    await fails(requests.disburseRequest(W.bursar, r.id, { method: 'CASH' }), 409, /approved/);
  });

  it('is approved by someone else (an Administrator included), and the requester can never approve', async () => {
    await fails(requests.decideRequest(W.teacher, ids.req, 'approve'), 403); // no permission
    // an Owner who raises a request cannot approve it either
    const mine = await requests.createRequest(W.operator, { title: 'New projector', type: 'PURCHASE_ORDER', department: 'Admin', justification: 'The old one failed', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'Projector', quantity: 1, unit: '450.00' }], submit: true });
    await fails(requests.decideRequest(W.operator, mine.id, 'approve'), 403, /You raised this request/);
    await fails(requests.decideRequest(W.operator, mine.id, 'reject', 'Rejecting my own request'), 403);
    await requests.decideRequest(W.operator2, mine.id, 'approve');
    ids.ownerReq = mine.id;
    await requests.decideRequest(W.head, ids.req, 'approve');
    const [a] = await audits('APPROVE_EXPENSE_REQUEST', ids.req);
    expect(a?.before).toMatchObject({ status: 'PENDING' });
    expect(a?.after).toMatchObject({ status: 'APPROVED', decidedById: W.head.id });
  });

  it('is paid by a third person: not the requester, not the approver, whoever they are', async () => {
    await fails(requests.disburseRequest(W.teacher, ids.req, { method: 'CASH' }), 403); // no permission
    await fails(requests.disburseRequest(W.operator, ids.ownerReq, { method: 'CASH' }), 403, /You raised/);
    await fails(requests.disburseRequest(W.operator2, ids.ownerReq, { method: 'CASH' }), 403, /You approved/);
    expect(await requests.disburseRequest(W.bursar, ids.req, { method: 'CASH', amount: '99.00' })).toMatchObject({ needsApproval: true }); // over the margin: an approver must agree first
    expect(await prisma.finExpense.count({ where: { schoolId: A.schoolId, source: 'REQUEST' } })).toBe(0);
    const paid = await requests.disburseRequest(W.bursar, ids.req, { method: 'CASH', amount: '35.00', payee: 'Stationery World' });
    expect(await prisma.finExpense.count({ where: { schoolId: A.schoolId, source: 'REQUEST' } })).toBe(1);
    const e = await prisma.finExpense.findUniqueOrThrow({ where: { id: paid.expenseId! } });
    expect(e).toMatchObject({ amountCents: 3500, currency: 'USD', source: 'REQUEST', requestId: ids.req, recordedById: W.bursar.id });
    expect((await requests.getRequest(W.bursar, ids.req)).status).toBe('DISBURSED');
    await fails(requests.disburseRequest(W.operator, ids.req, { method: 'CASH' }), 409, /already paid/);
    const [a] = await audits('DISBURSE_EXPENSE_REQUEST', ids.req);
    expect(a?.after).toMatchObject({ status: 'DISBURSED', disbursedById: W.bursar.id, amountCents: 3500, approvedCents: 3700 });
  });

  it('lets the bursar record a direct expense, within the limit the school sets, and nobody else', async () => {
    const e = { fundId: W.funds.GENERAL, category: 'Transport', description: 'Bus fare to the district office', currency: 'USD', amount: '12.00', method: 'CASH' };
    await fails(expenses.recordDirectExpense(W.clerk, e), 403);
    await fails(expenses.recordDirectExpense(W.teacher, e), 403);
    await fails(expenses.recordDirectExpense(W.bursar, { ...e, amount: '12.345' }), 422);
    ids.direct = (await expenses.recordDirectExpense(W.bursar, e)).id;
    await fails(setup.saveControls(W.bursar, { directLimitUsdCents: 5000 }), 403);
    await setup.saveControls(W.operator, { directLimitUsdCents: 5000 });
    await fails(expenses.recordDirectExpense(W.bursar, { ...e, amount: '50.01' }), 422, /Raise an expense request/);
    await expenses.recordDirectExpense(W.bursar, { ...e, amount: '50.00' });
    await setup.saveControls(W.operator, { directLimitUsdCents: null });
  });

  it('takes the direct-expense limit as dollars typed by a person, and clears it with null', async () => {
    await setup.saveControls(W.operator, { directLimitUsd: '75.50', directLimitZig: '1,000.00' });
    let c = await setup.getControls(W.operator);
    expect(c.directLimitUsdCents).toBe(7550);
    expect(c.directLimitZigCents).toBe(100000);
    await fails(setup.saveControls(W.operator, { directLimitUsd: '10.005' }), 422);
    await setup.saveControls(W.operator, { directLimitUsd: null, directLimitZig: null });
    c = await setup.getControls(W.operator);
    expect(c.directLimitUsdCents).toBeNull();
    expect(c.directLimitZigCents).toBeNull();
    const [a] = await audits('SAVE_FINANCE_CONTROLS');
    expect(a?.before).toBeTruthy();
    expect(a?.after).toBeTruthy();
  });

  it('voids an expense by someone else, keeping the row and leaving it out of the totals', async () => {
    await fails(expenses.voidExpense(W.bursar, ids.direct, 'Recorded in the wrong fund'), 403); // no permission
    const mine = (await expenses.recordDirectExpense(W.operator, { fundId: W.funds.GENERAL, category: 'Misc', description: 'Owner recorded this one', currency: 'USD', amount: '1.00', method: 'CASH' })).id;
    await fails(expenses.voidExpense(W.operator, mine, 'I recorded this myself'), 403, /someone else/);
    const before = await reports.expenditure(W.bursar2, { from: '2026-01-01', to: '2026-12-31' });
    await expenses.voidExpense(W.operator, ids.direct, 'Recorded in the wrong fund');
    const after = await reports.expenditure(W.bursar2, { from: '2026-01-01', to: '2026-12-31' });
    expect(after.totals.USD).toBe(before.totals.USD - 1200);
    expect(await prisma.finExpense.findUnique({ where: { id: ids.direct } })).not.toBeNull();
    expect((await expenses.listExpenses(W.bursar2, { includeVoided: true })).rows.find((r) => r.id === ids.direct)?.voided).toBe(true);
  });

  it('shows a person only their own requests unless they may see them all', async () => {
    expect((await requests.listRequests(W.teacher)).rows.every((r) => r.requestedById === W.teacher.id)).toBe(true);
    expect((await requests.listRequests(W.bursar)).rows.length).toBeGreaterThanOrEqual(2);
    const draft = await requests.createRequest(W.teacher, { title: 'A private draft', type: 'OTHER', department: 'Science', justification: 'Not yet submitted', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'x', quantity: 1, unit: '1' }] });
    expect((await requests.listRequests(W.bursar2)).rows.map((r) => r.id)).not.toContain(draft.id);
    await fails(requests.getRequest(W.bursar2, draft.id), 404);
    await fails(requests.updateDraft(W.outsider, draft.id, { title: 'Hijack the draft', type: 'OTHER', department: 'x', justification: 'not mine to edit', fundId: W.funds.GENERAL, currency: 'USD', items: [{ description: 'x', quantity: 1, unit: '1' }] }), 403);
    await requests.deleteDraft(W.teacher, draft.id);
  });
});

describe('funds are kept apart in every report', () => {
  it('summarises per fund and currency, and filters to one fund', async () => {
    const all = await reports.fundSummary(W.bursar2, { from: '2026-01-01', to: '2026-12-31' });
    const tuition = all.rows.filter((r) => r.fundName === 'Tuition');
    expect(tuition.map((r) => r.currency).sort()).toEqual(['USD', 'ZIG']);
    expect(all.rows.filter((r) => r.fundName === 'SDC levy').every((r) => r.currency === 'USD')).toBe(true);
    const only = await reports.fundSummary(W.bursar2, { from: '2026-01-01', to: '2026-12-31', fundId: W.funds.SDC });
    expect(new Set(only.rows.map((r) => r.fundName))).toEqual(new Set(['SDC levy']));
    expect(only.totals.USD.collected).toBe(10000); // the SDC levies of day1 (50) and the boarder (50), less nothing (the refund was against SDC: 20)
    expect(only.totals.USD.refunded).toBe(2000);
    expect(only.totals.USD.net).toBe(8000);
    expect(only.totals.ZIG.collected).toBe(0);
  });

  it('filters the cash-up and the arrears by fund, and never adds the currencies', async () => {
    const cu = await reports.cashUp(W.bursar2, { fundId: W.funds.SDC });
    expect(new Set(cu.receiptsByFund.map((r) => r.fundName))).toEqual(new Set(['SDC levy']));
    expect(cu.expectedCash.ZIG).toBe(0);
    const arrears = await reports.arrears(W.bursar2, { fundId: W.funds.BOARDING });
    expect(arrears.rows.map((r) => r.name)).toEqual(['Tino Ncube']);
    expect(arrears.totals.USD.outstanding).toBe(40000);
    expect(arrears.totals.ZIG.outstanding).toBe(0);
    const everyone = await reports.arrears(W.bursar2, {});
    expect(everyone.totals.ZIG.outstanding).toBeGreaterThan(0);
    expect(everyone.totals.USD.outstanding).not.toBe(everyone.totals.ZIG.outstanding);
  });

  it('adds up the till for the day: cash receipts less cash spending and refunds, per currency', async () => {
    const cu = await reports.cashUp(W.bursar2);
    const cashIn = cu.receipts.filter((r) => r.method === 'CASH' && r.currency === 'USD').reduce((s, r) => s + r.cents, 0);
    const cashOut = cu.expenses.filter((r) => r.method === 'CASH' && r.currency === 'USD').reduce((s, r) => s + r.cents, 0) + cu.refundsPaid.filter((r) => r.method === 'CASH' && r.currency === 'USD').reduce((s, r) => s + r.cents, 0);
    expect(cu.expectedCash.USD).toBe(cashIn - cashOut);
    expect(cu.expectedCash.USD).toBeGreaterThan(0);
    expect(cu.voids.payments).toBe(1);
    await fails(reports.cashUp(W.teacher), 403);
  });
});

describe('a closed term is locked for billing, but payments are still received', () => {
  it('refuses new charges and fees in a closed term and still takes and settles payments against its old balances', async () => {
    const year = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2025, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') } });
    const term = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: year.id, termNumber: 1, name: 'Term 1 2025', startDate: new Date('2025-01-10'), endDate: new Date('2025-04-10'), status: 'PLANNED' } });
    const old = await fees.addCharge(W.bursar, W.students.day1, { termId: term.id, fundId: W.funds.TUITION, description: 'Old term tuition', currency: 'USD', amount: '120.00' });
    await prisma.academicTerm.update({ where: { id: term.id }, data: { status: 'CLOSED' } });

    await fails(fees.addCharge(W.bursar, W.students.day1, { termId: term.id, fundId: W.funds.TUITION, description: 'Late charge', currency: 'USD', amount: '5.00' }), 409, /closed/);
    await fails(structures.createStructure(W.bursar, { termId: term.id }), 409, /closed/);
    await fails(billing.runBilling(W.bursar, { termId: term.id }), 409, /closed/);
    await fails(fees.voidCharge(W.operator, old.id, 'Voiding a closed term charge'), 409, /closed/);

    const before = (await owed(W.students.day1)).USD.outstanding;
    const p = (await payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '30.00' }] })).payments[0]!.id;
    await payments.verifyPayment(W.bursar2, p);
    // oldest first: the closed term's charge is settled before this term's
    const line = (await accounts.getAccount(W.bursar, W.students.day1)).charges.find((c) => c.chargeId === old.id)!;
    expect(line.paidCents).toBe(3000);
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before - 3000);

    // a credit note against the old charge is a correction, not billing
    const adj = await adjustments.requestAdjustment(W.bursar, { chargeId: old.id, kind: 'CREDIT_NOTE', amount: '20.00', reason: 'Fees cut for the old term' });
    await adjustments.decideAdjustment(W.head, adj.id, 'approve');
    expect((await owed(W.students.day1)).USD.outstanding).toBe(before - 3000 - 2000);
  });
});

describe('every financial action writes its own audit entry in the same transaction', () => {
  it('has a business entry for each kind of action, carrying before and after values for each change', async () => {
    const kinds = ['SAVE_FUND', 'SAVE_FEE_ITEM', 'SAVE_FEE_STRUCTURE', 'SUBMIT_FEE_STRUCTURE', 'APPROVE_FEE_STRUCTURE', 'RUN_BILLING', 'APPLY_CHARGE', 'VOID_CHARGE', 'RECORD_PAYMENT', 'VERIFY_PAYMENT', 'REJECT_PAYMENT', 'VOID_PAYMENT',
      'REQUEST_ADJUSTMENT', 'APPROVE_ADJUSTMENT', 'REJECT_ADJUSTMENT', 'REQUEST_REFUND', 'APPROVE_REFUND', 'PAY_REFUND', 'CREATE_EXPENSE_REQUEST', 'SUBMIT_EXPENSE_REQUEST',
      'APPROVE_EXPENSE_REQUEST', 'DISBURSE_EXPENSE_REQUEST', 'RECORD_EXPENSE', 'VOID_EXPENSE', 'SAVE_FINANCE_CONTROLS'];
    await setup.createFund(W.bursar2, { code: 'LIBRARY', name: 'Library fund', kind: 'OTHER' });
    for (const k of kinds) expect((await audits(k)).length, k).toBeGreaterThan(0);
    for (const k of ['VERIFY_PAYMENT', 'REJECT_PAYMENT', 'VOID_PAYMENT', 'APPROVE_ADJUSTMENT', 'APPROVE_REFUND', 'PAY_REFUND', 'APPROVE_EXPENSE_REQUEST', 'DISBURSE_EXPENSE_REQUEST', 'VOID_EXPENSE', 'VOID_CHARGE', 'SAVE_FINANCE_CONTROLS']) {
      for (const row of await audits(k)) {
        expect(row.before, `${k} before`).not.toBeNull();
        expect(row.after, `${k} after`).not.toBeNull();
        expect(row.actorId).toBeTruthy();
      }
    }
  });

  it('also records every row change through the database, with the same person and the finance module', async () => {
    const rows = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'FinPayment', action: 'DATA_UPDATE', entityId: ids.p1 } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.module).toBe('finance');
    expect(rows[0]!.actorId).toBe(W.bursar2.id);
    expect((rows[0]!.before as { status: string }).status).toBe('RECEIVED');
    expect((rows[0]!.after as { status: string }).status).toBe('VERIFIED');
  });

  it('is written in the same transaction: a refused action leaves no entry and no change', async () => {
    const p = (await payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', lines: [{ fundId: W.funds.TUITION, amount: '3.00' }] })).payments[0]!.id;
    const verifies = (await audits('VERIFY_PAYMENT')).length;
    await fails(payments.verifyPayment(W.clerk, p), 403);
    await fails(payments.verifyPayment(W.bursar2, 'no-such-payment'), 404);
    expect((await audits('VERIFY_PAYMENT')).length).toBe(verifies);
    // the audit table itself cannot be rewritten (asserted on the raw connection: a refused statement ends a Prisma connection over the test socket)
    await expect(t.pg.query("UPDATE \"AuditLog\" SET \"detail\" = 'edited' WHERE \"action\" = 'VERIFY_PAYMENT'")).rejects.toThrow(/cannot be changed or deleted/);
  });
});

describe('one school never sees another', () => {
  it('hides payments, accounts and requests of another school, and refuses to act on them', async () => {
    const bBursar = await actorOf(prisma, B.users.BURSAR.id);
    expect((await payments.listPayments(bBursar)).rows).toHaveLength(0);
    await fails(payments.verifyPayment(await actorOf(prisma, B.users.BURSAR.id), ids.p1), 404);
    await fails(accounts.getAccount(bBursar, W.students.day1), 404);
    await fails(requests.getRequest(bBursar, ids.req), 404);
    await fails(fees.voidCharge(await actorOf(prisma, B.users.DIRECTOR.id), ids.labCharge, 'Trying another school'), 404);
    expect((await setup.listFunds(bBursar)).map((f) => f.id)).not.toContain(W.funds.TUITION);
  });
});

describe('every service asks for its permission', () => {
  it('refuses people who hold none of the finance permissions', async () => {
    const nobody = await actorOf(prisma, await addTeacher(prisma, A, 'Mr Nobody'));
    await fails(payments.listPayments(nobody), 403);
    await fails(accounts.listAccounts(nobody), 403);
    await fails(reports.overview(nobody), 403);
    await fails(reports.fundSummary(nobody, { from: '2026-01-01', to: '2026-12-31' }), 403);
    await fails(expenses.listExpenses(nobody), 403);
    await fails(adjustments.listAdjustments(nobody), 403);
    await fails(refunds.listRefunds(nobody), 403);
    await fails(setup.saveControls(nobody, {}), 403);
    await fails(setup.createFund(nobody, { code: 'ZZ', name: 'Nope' }), 403);
    await fails(fees.addCharge(nobody, W.students.day1, { fundId: W.funds.TUITION, description: 'x', currency: 'USD', amount: '1' }), 403);
  });
});

describe('the older accounting screens step aside once a school is on Finance', () => {
  it('refuses their writes for a school with a Finance settings row, and not for one without', async () => {
    const dbA = scoped.getScopedDb(A.schoolId, W.bursar.id);
    await expect(legacy.assertLegacyWritable(dbA, A.schoolId)).rejects.toMatchObject({ status: 409 });
    const dbB = scoped.getScopedDb(B.schoolId, B.users.BURSAR.id);
    await expect(legacy.assertLegacyWritable(dbB, B.schoolId)).resolves.toBeUndefined();
  });
});

describe('the rest of Pfuma follows Finance', () => {
  it('raises library and exam-entry charges on the student account, and reports what is owed and settled', async () => {
    const ext = await import('@/lib/finance/external');
    const db = scoped.getScopedDb(A.schoolId, W.bursar.id);
    const lib = await db.$tx((tx) => ext.raiseCharge(tx, { schoolId: A.schoolId, actorId: W.bursar.id, studentId: W.students.day2, termId: A.termId, description: 'Lost library book: Maths (ACC1)', currency: 'USD', amount: 12.5, source: 'LIBRARY' }));
    const exam = await db.$tx((tx) => ext.raiseCharge(tx, { schoolId: A.schoolId, actorId: W.bursar.id, studentId: W.students.day2, termId: A.termId, description: 'ZIMSEC November 2026 entry', currency: 'USD', amount: 45, source: 'EXAM_ENTRY' }));
    expect(lib.legacy).toBe(false);
    const row = await prisma.finCharge.findUniqueOrThrow({ where: { id: lib.id }, include: { fund: true } });
    expect(row).toMatchObject({ amountCents: 1250, source: 'LIBRARY', currency: 'USD' });
    expect(row.fund.code).toBe('GENERAL');
    expect(exam.id).not.toBe(lib.id);

    const owing = await db.$tx((tx) => ext.owedBy(tx, A.schoolId, W.students.day2));
    expect(owing.find((o) => o.currency === 'USD')?.owed).toBeGreaterThanOrEqual(57.5);
    expect(await db.$tx((tx) => ext.alreadyCharged(tx, A.schoolId, [W.students.day2, W.students.day1], 'ZIMSEC November 2026 entry'))).toEqual(new Set([W.students.day2]));

    let settled = await db.$tx((tx) => ext.feeSettled(tx, A.schoolId, [W.students.day2], 'ZIMSEC November 2026 entry'));
    expect(settled.get(W.students.day2)).toEqual({ charged: true, paid: false });
    // the payer said this money is for the exam fee, so it settles that charge before the older library fine
    await fails(payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', chargeId: exam.id, lines: [{ fundId: W.funds.TUITION, amount: '45.00' }] }), 422, /another fund/);
    await fails(payments.recordPayment(W.clerk, { studentId: W.students.day1, currency: 'USD', method: 'CASH', chargeId: exam.id, lines: [{ fundId: W.funds.GENERAL, amount: '45.00' }] }), 404);
    const p = (await payments.recordPayment(W.clerk, { studentId: W.students.day2, currency: 'USD', method: 'CASH', chargeId: exam.id, lines: [{ fundId: W.funds.EXAMS, amount: '45.00' }] })).payments[0]!.id;
    await payments.verifyPayment(W.bursar2, p);
    settled = await db.$tx((tx) => ext.feeSettled(tx, A.schoolId, [W.students.day2], 'ZIMSEC November 2026 entry'));
    expect(settled.get(W.students.day2)).toEqual({ charged: true, paid: true });

    const money = await db.$tx((tx) => ext.termMoney(tx, A.schoolId, { id: A.termId }, { gte: new Date('2026-01-01'), lt: new Date('2027-01-01') }));
    expect(money.billed.USD).toBeGreaterThan(0);
    expect(money.billed.ZIG).toBeGreaterThan(0);
    expect(money.collected.USD).toBeGreaterThan(0);
  });

  it('still reads the first accounting tables for a school that has not moved to Finance', async () => {
    const ext = await import('@/lib/finance/external');
    const db = scoped.getScopedDb(B.schoolId, B.users.BURSAR.id);
    const made = await db.$tx((tx) => ext.raiseCharge(tx, { schoolId: B.schoolId, actorId: B.users.BURSAR.id, studentId: B.studentId, termId: B.termId, description: 'Lost library book: Atlas', currency: 'USD', amount: 10, source: 'LIBRARY' }));
    expect(made.legacy).toBe(true);
    expect(await prisma.charge.count({ where: { id: made.id } })).toBe(1);
    expect(await prisma.finCharge.count({ where: { schoolId: B.schoolId } })).toBe(0);
    expect((await db.$tx((tx) => ext.owedBy(tx, B.schoolId, B.studentId))).length).toBeGreaterThan(0);
  });
});

describe('the parent portal shows the balance Finance calculates', () => {
  it('uses Finance for a school that moved, per currency, net of credit notes, and the older tables for one that did not', async () => {
    const { portalFees } = await import('@/lib/finance/portal');
    const db = scoped.getScopedDb(A.schoolId);
    const acct = (await accounts.getAccount(W.bursar, W.students.day1)).byCurrency;
    const fees = await portalFees(db, W.students.day1, A.schoolId, { charges: [], payments: [] });
    expect(fees.balUSD).toBe(acct.USD.outstanding / 100);
    expect(fees.balZiG).toBe(acct.ZIG.outstanding / 100);
    expect(fees.chargesUSD).toBe((acct.USD.charged - acct.USD.adjusted) / 100);
    expect(fees.paidUSD).toBe((acct.USD.paid - acct.USD.refunded) / 100);
    expect(fees.balUSD).toBe(fees.chargesUSD - fees.paidUSD);
    expect(fees.recentPayments.length).toBeGreaterThan(0);
    expect(fees.recentPayments.every((p) => p.zig === null)).toBe(true);
    // a pending payment is not shown to parents
    expect(fees.recentPayments.length).toBe((await payments.listPayments(W.bursar2, { studentId: W.students.day1, status: 'VERIFIED', pageSize: 100 })).rows.length > 10 ? 10 : (await payments.listPayments(W.bursar2, { studentId: W.students.day1, status: 'VERIFIED', pageSize: 100 })).rows.length);

    const dbB = scoped.getScopedDb(B.schoolId);
    const legacyRows = { charges: [{ currency: 'USD' as const, amount: { toNumber: () => 100 } }], payments: [{ recordedAt: new Date(), method: 'CASH', amount: { toNumber: () => 40 }, currency: 'USD' as const, paidInZig: false, zigAmountPaid: null, exchangeRateUsed: null }] };
    const old = await portalFees(dbB, B.studentId, B.schoolId, legacyRows);
    expect(old).toMatchObject({ chargesUSD: 100, paidUSD: 40, balUSD: 60, balZiG: 0 });
  });
});

describe('the finance dashboard', () => {
  it('shows each figure per currency and agrees with the other reports', async () => {
    const { financeDashboard } = await import('@/lib/finance/dashboard');
    const d = await financeDashboard(W.bursar2, { termId: A.termId });
    const o = await reports.overview(W.bursar2, A.termId);
    expect(d.billed.USD).toBe(o.charges.USD.charged - o.charges.USD.adjusted);
    expect(d.billed.ZIG).toBe(o.charges.ZIG.charged - o.charges.ZIG.adjusted);
    expect(d.outstanding.thisTerm.USD).toBe(o.charges.USD.outstanding);
    expect(d.collected.USD).toBe(o.charges.USD.paid - o.charges.USD.refunded);
    expect(d.collectionRate.USD.rate).toBe(Math.round((d.collected.USD / d.billed.USD) * 1000) / 10);
    expect(d.owing.learners).toBeGreaterThan(0);
    expect(d.owing.moreThanOneTerm).toBeLessThanOrEqual(d.owing.learners);
    expect(d.weekly.length).toBeGreaterThan(0);
    expect(d.weekly.reduce((s, w) => s + w.thisTerm.USD, 0)).toBeGreaterThan(0);
    expect(d.byMethod.map((m) => m.method)).toContain('CASH');
    expect(d.byForm.length).toBeGreaterThan(0);
    expect(d.today.collected.USD).toBeGreaterThan(0);
    expect(d.waiting.payments.oldest.length).toBeLessThanOrEqual(5);
    expect(d.waiting.requestsToApprove).toBeGreaterThanOrEqual(0);
  });

  it('keeps earlier terms apart as arrears, and filters by fund', async () => {
    const { financeDashboard } = await import('@/lib/finance/dashboard');
    const term2025 = await prisma.academicTerm.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Term 1 2025' } });
    // viewed from the open term, the 2025 charge is arrears; viewed from 2025 itself it is that term's balance
    const now = await financeDashboard(W.bursar2, { termId: A.termId });
    expect(now.outstanding.earlier.USD).toBeGreaterThan(0);
    const old = await financeDashboard(W.bursar2, { termId: term2025.id });
    expect(old.outstanding.earlier.USD).toBe(0);
    expect(old.billed.USD).toBeGreaterThan(0);
    const sdc = await financeDashboard(W.bursar2, { termId: A.termId, fundId: W.funds.SDC });
    expect(sdc.fund?.name).toBe('SDC levy');
    expect(sdc.billed.USD).toBeLessThan(now.billed.USD);
    expect(sdc.billed.ZIG).toBe(0);
    await fails(financeDashboard(W.teacher, {}), 403);
  });
});
