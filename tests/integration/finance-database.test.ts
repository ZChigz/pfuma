// @vitest-environment node
// The money rules the DATABASE keeps even if some code forgets them: statements go straight to PostgreSQL, around every service.
// (A refused statement is asserted on the raw connection: over the test socket a Prisma call that fails in a trigger ends the connection.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { financeWorld, type FinanceWorld } from '../helpers/finance';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: FinanceWorld;
let prisma: typeof import('@/lib/prisma').prisma;
const id: Record<string, string> = {};

const q = (sql: string, params: unknown[] = []) => t.pg.query(sql, params);
const bad = (sql: string, re: RegExp, params: unknown[] = []) => expect(q(sql, params)).rejects.toThrow(re);
const ok = async (sql: string, params: unknown[] = []) => (await q(sql, params)).rows;

let seq = 0;
const nid = () => `fx${++seq}`;
const insCharge = (o: { student: string; fund: string; currency?: string; amount?: number; term?: string; school?: string; item?: string | null; id?: string }) => {
  const cid = o.id ?? nid();
  return q(
    `INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","feeItemId","description","currency","amountCents","source") VALUES ($1,$2,$3,$4,$5,$6,'Test charge',$7::"Currency",$8,'MANUAL')`,
    [cid, o.school ?? A.schoolId, o.student, o.term ?? A.termId, o.fund, o.item ?? null, o.currency ?? 'USD', o.amount ?? 10000],
  ).then(() => cid);
};
const insPayment = (o: { student: string; fund: string; currency?: string; amount?: number; by: string; status?: string; school?: string; id?: string; verifiedBy?: string }) => {
  const pid = o.id ?? nid();
  const verified = o.status === 'VERIFIED';
  return q(
    `INSERT INTO "FinPayment" ("id","schoolId","studentId","fundId","receiptNumber","currency","amountCents","method","receivedOn","recordedById","status","verifiedById","verifiedAt")
     VALUES ($1,$2,$3,$4,$5,$6::"Currency",$7,'CASH',CURRENT_DATE,$8,$9::"FinPaymentStatus",$10,$11)`,
    [pid, o.school ?? A.schoolId, o.student, o.fund, `R-${pid}`, o.currency ?? 'USD', o.amount ?? 10000, o.by, verified ? 'PENDING' : (o.status ?? 'PENDING'), null, null],
  ).then(async () => {
    if (verified) await q(`UPDATE "FinPayment" SET "status" = 'VERIFIED', "verifiedById" = $2, "verifiedAt" = now() WHERE "id" = $1`, [pid, o.verifiedBy ?? W.head.id]);
    return pid;
  });
};
const alloc = (payment: string, charge: string, amount: number, by = W.head.id) =>
  q(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ($1,$2,$3,$4,$5,$6)`, [nid(), A.schoolId, payment, charge, amount, by]);

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await financeWorld(prisma, A);
  const setup = await import('@/lib/finance/setup');
  W.funds = Object.fromEntries((await setup.listFunds(W.bursar)).map((f) => [f.code, f.id]));
  // The schoolB funds, to prove references cannot cross over.
  const bBursar = (await import('../helpers/academics')).actorOf(prisma, B.users.BURSAR.id);
  id.bFund = (await setup.listFunds(await bBursar))[0]!.id;
  id.bStudent = B.studentId;
  id.tuition = W.funds.TUITION!;
  id.sdc = W.funds.SDC!;
  id.day1 = W.students.day1;
  id.day2 = W.students.day2;
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('amounts are integer cents', () => {
  it('stores every amount in an integer column, never a float or a decimal', async () => {
    const cols = await ok(
      `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~ 'Cents$' AND table_name ~ '^(Fin|Fund)' ORDER BY 1, 2`,
    );
    expect(cols.length).toBeGreaterThanOrEqual(12);
    for (const c of cols as { t: string; c: string; d: string }[]) expect(c.d, `${c.t}.${c.c}`).toBe('integer');
    // and no money column of the new tables is a decimal or a float
    const floats = await ok(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name ~ '^(Fin)' AND data_type IN ('numeric', 'double precision', 'real')`,
    );
    expect(floats).toEqual([]);
  });

  it('refuses a zero or negative amount in every money table', async () => {
    const c = await insCharge({ student: id.day1!, fund: id.tuition! });
    await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('z1',$1,$2,$3,$4,'x','USD',0)`, /FinCharge_amount/, [A.schoolId, id.day1, A.termId, id.tuition]);
    await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('z2',$1,$2,$3,$4,'x','USD',-5)`, /FinCharge_amount/, [A.schoolId, id.day1, A.termId, id.tuition]);
    await bad(`INSERT INTO "FinPayment" ("id","schoolId","studentId","fundId","receiptNumber","currency","amountCents","method","receivedOn","recordedById") VALUES ('z3',$1,$2,$3,'Z3','USD',0,'CASH',CURRENT_DATE,$4)`, /FinPayment_amount/, [A.schoolId, id.day1, id.tuition, W.clerk.id]);
    const zp = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 500, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('z4',$1,$2,$3,0,$4)`, /FinPaymentAllocation_amount/, [A.schoolId, zp, c, W.head.id]);
    expect(c).toBeTruthy();
  });
});

describe('nothing financial is edited or deleted', () => {
  let charge: string;
  let payment: string;
  it('refuses to change or delete a charge', async () => {
    charge = await insCharge({ student: id.day1!, fund: id.tuition!, amount: 20000 });
    await bad(`UPDATE "FinCharge" SET "amountCents" = 1 WHERE "id" = $1`, /never deleted|only be added|cannot be edited/, [charge]);
    await bad(`UPDATE "FinCharge" SET "description" = 'edited' WHERE "id" = $1`, /only be added/, [charge]);
    await bad(`DELETE FROM "FinCharge" WHERE "id" = $1`, /only be added/, [charge]);
  });

  it('refuses to edit the amount, student, fund or currency of a payment, to delete it, or to move it backwards', async () => {
    payment = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 20000, by: W.clerk.id, status: 'VERIFIED' });
    for (const set of [`"amountCents" = 1`, `"studentId" = '${id.day2}'`, `"fundId" = '${id.sdc}'`, `"currency" = 'ZIG'`, `"recordedById" = '${W.head.id}'`, `"receiptNumber" = 'X'`]) {
      await bad(`UPDATE "FinPayment" SET ${set} WHERE "id" = $1`, /cannot be edited|never changes/, [payment]);
    }
    await bad(`DELETE FROM "FinPayment" WHERE "id" = $1`, /never deleted/, [payment]);
    await bad(`UPDATE "FinPayment" SET "status" = 'PENDING', "verifiedById" = NULL, "verifiedAt" = NULL WHERE "id" = $1`, /cannot be changed/, [payment]);
    await bad(`UPDATE "FinPayment" SET "status" = 'REJECTED', "rejectedById" = $2, "rejectedAt" = now(), "rejectionReason" = 'x' WHERE "id" = $1`, /cannot be changed/, [payment, W.owner.id]);
  });

  it('refuses to edit or delete an allocation, a void, an expense, an adjustment amount or a refund amount', async () => {
    const c = await insCharge({ student: id.day1!, fund: id.tuition!, amount: 5000 });
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 5000, by: W.clerk.id, status: 'VERIFIED' });
    await alloc(p, c, 5000);
    await bad(`UPDATE "FinPaymentAllocation" SET "amountCents" = 1 WHERE "paymentId" = $1`, /only be added/, [p]);
    await bad(`DELETE FROM "FinPaymentAllocation" WHERE "paymentId" = $1`, /only be added/, [p]);

    await q(`INSERT INTO "FinExpense" ("id","schoolId","fundId","category","description","currency","amountCents","paidOn","method","source","recordedById") VALUES ('e1',$1,$2,'x','Direct','USD',500,CURRENT_DATE,'CASH','DIRECT',$3)`, [A.schoolId, W.funds.GENERAL, W.bursar.id]);
    await bad(`UPDATE "FinExpense" SET "amountCents" = 1 WHERE "id" = 'e1'`, /only be added/);
    await bad(`DELETE FROM "FinExpense" WHERE "id" = 'e1'`, /only be added/);
    await q(`INSERT INTO "FinVoid" ("id","schoolId","expenseId","reason","voidedById") VALUES ('v1',$1,'e1','Entered twice by mistake',$2)`, [A.schoolId, W.owner.id]);
    await bad(`DELETE FROM "FinVoid" WHERE "id" = 'v1'`, /only be added/);
    await bad(`UPDATE "FinVoid" SET "reason" = 'something else entirely' WHERE "id" = 'v1'`, /only be added/);

    await q(`INSERT INTO "FinAdjustment" ("id","schoolId","chargeId","kind","amountCents","reason","createdById") VALUES ('a1',$1,$2,'CREDIT_NOTE',1000,'A good reason',$3)`, [A.schoolId, c, W.bursar.id]);
    await bad(`UPDATE "FinAdjustment" SET "amountCents" = 4000 WHERE "id" = 'a1'`, /cannot be edited/);
    await bad(`DELETE FROM "FinAdjustment" WHERE "id" = 'a1'`, /never deleted/);
    await q(`INSERT INTO "FinRefund" ("id","schoolId","paymentId","chargeId","amountCents","reason","requestedById") VALUES ('r1',$1,$2,$3,1000,'A good reason',$4)`, [A.schoolId, p, c, W.bursar.id]);
    await bad(`UPDATE "FinRefund" SET "amountCents" = 4000 WHERE "id" = 'r1'`, /cannot be edited/);
    await bad(`DELETE FROM "FinRefund" WHERE "id" = 'r1'`, /never deleted/);
  });

  it('never deletes a fund or a fee line, and a fund keeps its code', async () => {
    await bad(`DELETE FROM "Fund" WHERE "id" = $1`, /never deleted/, [id.sdc]);
    await bad(`UPDATE "Fund" SET "code" = 'OTHER' WHERE "id" = $1`, /cannot be edited/, [id.sdc]);
    await ok(`UPDATE "Fund" SET "name" = 'SDC levy fund' WHERE "id" = $1`, [id.sdc]);
    await ok(`UPDATE "Fund" SET "name" = 'SDC levy' WHERE "id" = $1`, [id.sdc]);
  });
});

describe('the person who records a payment cannot verify it, whatever the code does', () => {
  it('refuses the same person as recorder and verifier', async () => {
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, by: W.admin.id });
    await bad(`UPDATE "FinPayment" SET "status" = 'VERIFIED', "verifiedById" = $2, "verifiedAt" = now() WHERE "id" = $1`, /You recorded this payment/, [p, W.admin.id]);
    await bad(`UPDATE "FinPayment" SET "status" = 'REJECTED', "rejectedById" = $2, "rejectedAt" = now(), "rejectionReason" = 'no' WHERE "id" = $1`, /You recorded this payment/, [p, W.admin.id]);
    await ok(`UPDATE "FinPayment" SET "status" = 'VERIFIED', "verifiedById" = $2, "verifiedAt" = now() WHERE "id" = $1`, [p, W.owner.id]);
  });

  it('refuses a payment that arrives already verified', async () => {
    await bad(
      `INSERT INTO "FinPayment" ("id","schoolId","studentId","fundId","receiptNumber","currency","amountCents","method","receivedOn","recordedById","status","verifiedById","verifiedAt")
       VALUES ('sneak',$1,$2,$3,'SNEAK','USD',100,'CASH',CURRENT_DATE,$4,'VERIFIED',$5,now())`, /recorded as received or waiting/, [A.schoolId, id.day1, id.tuition, W.clerk.id, W.head.id]);
  });

  it('refuses a verified payment without a verifier', async () => {
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, by: W.clerk.id });
    await bad(`UPDATE "FinPayment" SET "status" = 'VERIFIED' WHERE "id" = $1`, /FinPayment_verified_has_person/, [p]);
  });
});

describe('spending needs three different people', () => {
  const request = async (reqId: string, o: { by: string; status?: string; approvedBy?: string; amount?: number; fund?: string }) => {
    await q(`INSERT INTO "FinExpenseRequest" ("id","schoolId","requestNumber","title","type","department","justification","fundId","currency","estimatedCents","requestedById") VALUES ($1,$2,$3,'Chalk','OTHER','Science','Need it',$4,'USD',$5,$6)`,
      [reqId, A.schoolId, `RQ-${reqId}`, o.fund ?? W.funds.GENERAL, o.amount ?? 5000, o.by]);
    await q(`INSERT INTO "FinExpenseRequestItem" ("id","schoolId","requestId","description","quantity","unitCents","totalCents") VALUES ($1,$2,$3,'Chalk',1,$4,$4)`, [nid(), A.schoolId, reqId, o.amount ?? 5000]);
    if (o.status && o.status !== 'DRAFT') await q(`UPDATE "FinExpenseRequest" SET "status" = 'PENDING', "submittedAt" = now() WHERE "id" = $1`, [reqId]);
    if (o.status === 'APPROVED') await q(`UPDATE "FinExpenseRequest" SET "status" = 'APPROVED', "approvedById" = $2, "approvedAt" = now() WHERE "id" = $1`, [reqId, o.approvedBy ?? W.head.id]);
  };

  it('refuses a request that approves itself, or rejects itself', async () => {
    await request('rq1', { by: W.owner.id, status: 'PENDING' });
    await bad(`UPDATE "FinExpenseRequest" SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = now() WHERE "id" = 'rq1'`, /You raised this request/, [W.owner.id]);
    await bad(`UPDATE "FinExpenseRequest" SET "status" = 'REJECTED', "rejectedById" = $1, "rejectedAt" = now(), "rejectionReason" = 'no' WHERE "id" = 'rq1'`, /You raised this request/, [W.owner.id]);
    await ok(`UPDATE "FinExpenseRequest" SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = now() WHERE "id" = 'rq1'`, [W.admin.id]);
  });

  it('refuses a draft that skips submission, and a submitted request that is edited', async () => {
    await request('rq2', { by: W.teacher.id });
    await bad(`UPDATE "FinExpenseRequest" SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = now() WHERE "id" = 'rq2'`, /must be submitted/, [W.head.id]);
    await request('rq3', { by: W.teacher.id, status: 'PENDING' });
    await bad(`UPDATE "FinExpenseRequest" SET "estimatedCents" = 999999 WHERE "id" = 'rq3'`, /cannot be edited/);
    await bad(`UPDATE "FinExpenseRequestItem" SET "unitCents" = 1, "totalCents" = 1 WHERE "requestId" = 'rq3'`, /cannot be changed/);
    await bad(`DELETE FROM "FinExpenseRequest" WHERE "id" = 'rq3'`, /Only a draft/);
    await bad(`UPDATE "FinExpenseRequest" SET "status" = 'PENDING', "submittedAt" = now(), "estimatedCents" = 7 WHERE "id" = 'rq2'`, /total must equal/); // lines say 5000
  });

  it('refuses an expense for a request that is not approved, or paid by the requester or the approver', async () => {
    const ins = (rq: string, by: string, amount = 5000) => q(
      `INSERT INTO "FinExpense" ("id","schoolId","fundId","category","description","currency","amountCents","paidOn","method","source","requestId","recordedById")
       VALUES ($1,$2,$3,'Other','Chalk','USD',$4,CURRENT_DATE,'CASH','REQUEST',$5,$6)`, [nid(), A.schoolId, W.funds.GENERAL, amount, rq, by]);
    await expect(ins('rq3', W.bursar.id, 1)).rejects.toThrow(/Only an approved request can be paid/);
    await expect(ins('rq1', W.admin.id)).rejects.toThrow(/cannot pay it out/); // approved by admin
    await request('rq4', { by: W.teacher.id, status: 'APPROVED', approvedBy: W.head.id });
    await expect(ins('rq4', W.teacher.id)).rejects.toThrow(/cannot pay it out/); // raised by the teacher
    await expect(ins('rq4', W.head.id)).rejects.toThrow(/cannot pay it out/); // approved by the head
    await expect(ins('rq4', W.bursar.id, 5001)).rejects.toThrow(/more than the amount approved/);
    // marking a request paid without an expense is refused
    await bad(`UPDATE "FinExpenseRequest" SET "status" = 'DISBURSED', "disbursedById" = $1, "disbursedAt" = now() WHERE "id" = 'rq4'`, /paid only by recording the expense/, [W.bursar.id]);
    await ins('rq4', W.bursar.id);
    await ok(`UPDATE "FinExpenseRequest" SET "status" = 'DISBURSED', "disbursedById" = $1, "disbursedAt" = now() WHERE "id" = 'rq4'`, [W.bursar.id]);
    // one expense per request
    await expect(ins('rq4', W.bursar.id)).rejects.toThrow();
  });

  it('refuses a direct expense that names a request, and a request expense without one', async () => {
    await bad(`INSERT INTO "FinExpense" ("id","schoolId","fundId","category","description","currency","amountCents","paidOn","method","source","requestId","recordedById") VALUES ('ex1',$1,$2,'x','x','USD',1,CURRENT_DATE,'CASH','DIRECT','rq1',$3)`, /FinExpense_source/, [A.schoolId, W.funds.GENERAL, W.bursar.id]);
    await bad(`INSERT INTO "FinExpense" ("id","schoolId","fundId","category","description","currency","amountCents","paidOn","method","source","recordedById") VALUES ('ex2',$1,$2,'x','x','USD',1,CURRENT_DATE,'CASH','REQUEST',$3)`, /FinExpense_source/, [A.schoolId, W.funds.GENERAL, W.bursar.id]);
  });
});

describe('adjustments and refunds: three people, never more than exists', () => {
  it('refuses an adjustment that approves itself or is more than the charge', async () => {
    const c = await insCharge({ student: id.day2!, fund: id.tuition!, amount: 10000 });
    await q(`INSERT INTO "FinAdjustment" ("id","schoolId","chargeId","kind","amountCents","reason","createdById") VALUES ('aj1',$1,$2,'DISCOUNT',6000,'A good reason',$3)`, [A.schoolId, c, W.owner.id]);
    await bad(`UPDATE "FinAdjustment" SET "status" = 'APPROVED', "decidedById" = $1, "decidedAt" = now() WHERE "id" = 'aj1'`, /You asked for this adjustment/, [W.owner.id]);
    await bad(`INSERT INTO "FinAdjustment" ("id","schoolId","chargeId","kind","amountCents","reason","createdById") VALUES ('aj2',$1,$2,'DISCOUNT',4001,'A good reason',$3)`, /cannot be more than the charge/, [A.schoolId, c, W.owner.id]);
    await bad(`INSERT INTO "FinAdjustment" ("id","schoolId","chargeId","kind","amountCents","reason","createdById","status","decidedById","decidedAt") VALUES ('aj3',$1,$2,'DISCOUNT',10,'A good reason',$3,'APPROVED',$4,now())`, /asked for as pending/, [A.schoolId, c, W.bursar.id, W.head.id]);
    await ok(`UPDATE "FinAdjustment" SET "status" = 'APPROVED', "decidedById" = $1, "decidedAt" = now() WHERE "id" = 'aj1'`, [W.head.id]);
    await bad(`UPDATE "FinAdjustment" SET "status" = 'REJECTED', "decidedById" = $1, "decidedAt" = now() WHERE "id" = 'aj1'`, /already been decided/, [W.head.id]);
  });

  it('refuses an approval that would take the charge below what has been paid on it', async () => {
    const c = await insCharge({ student: id.day2!, fund: id.tuition!, amount: 10000 });
    const p = await insPayment({ student: id.day2!, fund: id.tuition!, amount: 8000, by: W.clerk.id, status: 'VERIFIED' });
    await alloc(p, c, 8000);
    await q(`INSERT INTO "FinAdjustment" ("id","schoolId","chargeId","kind","amountCents","reason","createdById") VALUES ('aj4',$1,$2,'WAIVER',5000,'A good reason',$3)`, [A.schoolId, c, W.bursar.id]);
    await bad(`UPDATE "FinAdjustment" SET "status" = 'APPROVED', "decidedById" = $1, "decidedAt" = now() WHERE "id" = 'aj4'`, /paid in the meantime/, [W.head.id]);
  });

  it('refuses a refund approved by its requester, paid by its requester or approver, or larger than the payment settled', async () => {
    const c = await insCharge({ student: id.day2!, fund: id.sdc!, amount: 5000 });
    const p = await insPayment({ student: id.day2!, fund: id.sdc!, amount: 5000, by: W.clerk.id, status: 'VERIFIED' });
    await alloc(p, c, 4000);
    await bad(`INSERT INTO "FinRefund" ("id","schoolId","paymentId","chargeId","amountCents","reason","requestedById") VALUES ('rf1',$1,$2,$3,4001,'A good reason',$4)`, /can still be refunded against this charge/, [A.schoolId, p, c, W.bursar.id]);
    await bad(`INSERT INTO "FinRefund" ("id","schoolId","paymentId","amountCents","reason","requestedById") VALUES ('rf2',$1,$2,1001,'A good reason',$3)`, /unallocated credit/, [A.schoolId, p, W.bursar.id]);
    await q(`INSERT INTO "FinRefund" ("id","schoolId","paymentId","chargeId","amountCents","reason","requestedById") VALUES ('rf3',$1,$2,$3,1000,'A good reason',$4)`, [A.schoolId, p, c, W.bursar.id]);
    await bad(`UPDATE "FinRefund" SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = now() WHERE "id" = 'rf3'`, /You asked for this refund/, [W.bursar.id]);
    await bad(`UPDATE "FinRefund" SET "status" = 'PAID', "paidById" = $1, "paidAt" = now(), "method" = 'CASH' WHERE "id" = 'rf3'`, /cannot go from REQUESTED to PAID/, [W.owner.id]);
    await ok(`UPDATE "FinRefund" SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = now() WHERE "id" = 'rf3'`, [W.admin.id]);
    await bad(`UPDATE "FinRefund" SET "status" = 'PAID', "paidById" = $1, "paidAt" = now(), "method" = 'CASH' WHERE "id" = 'rf3'`, /cannot pay it out/, [W.admin.id]);
    await bad(`UPDATE "FinRefund" SET "status" = 'PAID', "paidById" = $1, "paidAt" = now(), "method" = 'CASH' WHERE "id" = 'rf3'`, /cannot pay it out/, [W.bursar.id]);
    await ok(`UPDATE "FinRefund" SET "status" = 'PAID', "paidById" = $1, "paidAt" = now(), "method" = 'CASH' WHERE "id" = 'rf3'`, [W.owner.id]);
    // a paid refund frees the charge again, so the money can be allocated anew; but never twice
    await alloc(p, c, 1000); // 4000 of 5000 allocated, 1000 left on the payment
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('al9',$1,$2,$3,1,$4)`, /left to allocate/, [A.schoolId, p, c, W.head.id]);
  });
});

describe('funds and currencies are never mixed', () => {
  it('refuses to allocate a payment to a charge of another fund, another currency or another student', async () => {
    const tuition = await insCharge({ student: id.day1!, fund: id.tuition!, amount: 9000 });
    const zig = await insCharge({ student: id.day1!, fund: id.tuition!, currency: 'ZIG', amount: 9000 });
    const other = await insCharge({ student: id.day2!, fund: id.sdc!, amount: 9000 });
    const sdcPayment = await insPayment({ student: id.day1!, fund: id.sdc!, amount: 9000, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('m1',$1,$2,$3,100,$4)`, /for one fund can only settle/, [A.schoolId, sdcPayment, tuition, W.head.id]);
    const usd = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 9000, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('m2',$1,$2,$3,100,$4)`, /currencies are never mixed/, [A.schoolId, usd, zig, W.head.id]);
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('m3',$1,$2,$3,100,$4)`, /same student/, [A.schoolId, usd, other, W.head.id]);
    await alloc(usd, tuition, 9000);
  });

  it('refuses to allocate an unverified, rejected or voided payment, a voided charge, or more than exists', async () => {
    const c = await insCharge({ student: id.day1!, fund: id.tuition!, amount: 3000 });
    const pending = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 3000, by: W.clerk.id });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('u1',$1,$2,$3,100,$4)`, /only after it has been verified/, [A.schoolId, pending, c, W.head.id]);
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 3000, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('u2',$1,$2,$3,3001,$4)`, /left to allocate|left to pay/, [A.schoolId, p, c, W.head.id]);
    await q(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","reason","voidedById") VALUES ('vp',$1,$2,'Wrong student entered',$3)`, [A.schoolId, p, W.owner.id]);
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('u3',$1,$2,$3,100,$4)`, /voided/, [A.schoolId, p, c, W.head.id]);
    const p2 = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 9000, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinPaymentAllocation" ("id","schoolId","paymentId","chargeId","amountCents","createdById") VALUES ('u4',$1,$2,$3,3001,$4)`, /left to pay/, [A.schoolId, p2, c, W.head.id]);
  });
});

describe('a void is its own row and follows its own rules', () => {
  it('refuses a payment or expense voided by the person who recorded it, a short reason, or two targets at once', async () => {
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 500, by: W.clerk.id, status: 'VERIFIED' });
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","reason","voidedById") VALUES ('x1',$1,$2,'A fair reason given',$3)`, /You recorded this payment/, [A.schoolId, p, W.clerk.id]);
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","reason","voidedById") VALUES ('x2',$1,$2,'short',$3)`, /FinVoid_reason/, [A.schoolId, p, W.owner.id]);
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","expenseId","reason","voidedById") VALUES ('x3',$1,$2,'e1','A fair reason given',$3)`, /FinVoid_one_target/, [A.schoolId, p, W.owner.id]);
    await q(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","reason","voidedById") VALUES ('x4',$1,$2,'A fair reason given',$3)`, [A.schoolId, p, W.owner.id]);
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","paymentId","reason","voidedById") VALUES ('x5',$1,$2,'A second void of the same',$3)`, /duplicate key|unique/, [A.schoolId, p, W.admin.id]);
  });

  it('refuses to void a charge that has payments against it', async () => {
    const c = await insCharge({ student: id.day2!, fund: id.tuition!, amount: 500 });
    const p = await insPayment({ student: id.day2!, fund: id.tuition!, amount: 500, by: W.clerk.id, status: 'VERIFIED' });
    await alloc(p, c, 500);
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","chargeId","reason","voidedById") VALUES ('x6',$1,$2,'A fair reason given',$3)`, /payments or adjustments against it/, [A.schoolId, c, W.owner.id]);
  });
});

describe('a closed term takes no new charges, but payments still come in', () => {
  it('refuses a charge or a fee line in a closed term and still allocates a payment to an old charge', async () => {
    const year = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2024, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') } });
    const term = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: year.id, termNumber: 1, name: 'Term 1 2024', startDate: new Date('2024-01-10'), endDate: new Date('2024-04-10'), status: 'PLANNED' } });
    const old = await insCharge({ student: id.day1!, fund: id.tuition!, amount: 4000, term: term.id });
    await q(`UPDATE "AcademicTerm" SET "status" = 'CLOSED' WHERE "id" = $1`, [term.id]);
    await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('cl1',$1,$2,$3,$4,'Late','USD',100)`, /is closed/, [A.schoolId, id.day1, term.id, id.tuition]);
    await bad(`INSERT INTO "FinFeeItem" ("id","schoolId","termId","fundId","name","currency","amountCents","createdById","updatedAt") VALUES ('cl2',$1,$2,$3,'Late fee','USD',100,$4,now())`, /is closed/, [A.schoolId, term.id, id.tuition, W.bursar.id]);
    await bad(`INSERT INTO "FinVoid" ("id","schoolId","chargeId","reason","voidedById") VALUES ('cl3',$1,$2,'Trying to void an old charge',$3)`, /is closed/, [A.schoolId, old, W.owner.id]);
    const p = await insPayment({ student: id.day1!, fund: id.tuition!, amount: 4000, by: W.clerk.id, status: 'VERIFIED' });
    await alloc(p, old, 4000); // a payment against an old balance is still welcome
  });
});

describe('one school never reaches another school’s money', () => {
  it('refuses a row that points into another school', async () => {
    await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('xs1',$1,$2,$3,$4,'x','USD',100)`, /Cross-school/, [A.schoolId, id.bStudent, A.termId, id.tuition]);
    await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('xs2',$1,$2,$3,$4,'x','USD',100)`, /Cross-school/, [A.schoolId, id.day1, A.termId, id.bFund]);
    await bad(`INSERT INTO "FinPayment" ("id","schoolId","studentId","fundId","receiptNumber","currency","amountCents","method","receivedOn","recordedById") VALUES ('xs3',$1,$2,$3,'XS3','USD',100,'CASH',CURRENT_DATE,$4)`, /Cross-school/, [A.schoolId, id.day1, id.tuition, B.users.BURSAR.id]);
  });

  it('shows a connection scoped to one school only that school’s rows', async () => {
    await q(`SELECT set_config('app.school_id', $1, false)`, [B.schoolId]);
    try {
      expect((await ok(`SELECT count(*)::int AS n FROM "FinPayment"`))[0]).toEqual({ n: 0 });
      expect((await ok(`SELECT count(*)::int AS n FROM "FinCharge"`))[0]).toEqual({ n: 0 });
      await bad(`INSERT INTO "FinCharge" ("id","schoolId","studentId","termId","fundId","description","currency","amountCents") VALUES ('xs4',$1,$2,$3,$4,'x','USD',100)`, /row-level security/, [A.schoolId, id.day1, A.termId, id.tuition]);
    } finally {
      await q(`SELECT set_config('app.school_id', '', false)`);
    }
    expect(((await ok(`SELECT count(*)::int AS n FROM "FinPayment"`))[0] as { n: number }).n).toBeGreaterThan(0);
  });
});

describe('every money table is audited by the database and isolated by row-level security', () => {
  it('has the audit trigger and the school policy on each table', async () => {
    const tables = ['Fund', 'FinFeeItem', 'FinCharge', 'FinPayment', 'FinPaymentAllocation', 'FinAdjustment', 'FinRefund', 'FinVoid', 'FinExpenseRequest', 'FinExpenseRequestItem', 'FinExpense', 'FinSettings'];
    for (const tb of tables) {
      const trg = await ok(`SELECT 1 FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`, [`"${tb}"`, `audit_${tb}`]);
      expect(trg, `${tb} audit trigger`).toHaveLength(1);
      const pol = await ok(`SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = 'school_isolation'`, [tb]);
      expect(pol, `${tb} policy`).toHaveLength(1);
      const rls = await ok(`SELECT relrowsecurity AND relforcerowsecurity AS on FROM pg_class WHERE relname = $1`, [tb]);
      expect((rls[0] as { on: boolean }).on, `${tb} RLS`).toBe(true);
    }
  });
});
