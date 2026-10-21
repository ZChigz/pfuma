// @vitest-environment node
// The Finance migrations applied on top of a school that already has fees, payments and spending in the first accounting tables:
// everything carries over in whole cents, every student's balance is the same as before (per currency), voids stay voids, the old
// tables are not touched, the data step can run twice, and roles get the module's keys.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await all<T>(sql, params))[0]!;
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) x`, params)).n);

const FIRST = '20261103000000_finance_core';
const BACKFILL = '20261103000100_finance_core_backfill';

// What the older screens showed: charges − verified, unvoided payments, per student and currency, in cents.
const legacyBalances = () => all<{ studentId: string; currency: string; owed: string }>(`
  SELECT c."studentId", c."currency"::text AS currency,
         (round(sum(c."amount") * 100) - COALESCE((SELECT round(sum(p."amount") * 100) FROM "Payment" p WHERE p."studentId" = c."studentId" AND p."currency" = c."currency" AND p."status" = 'VERIFIED'), 0))::text AS owed
    FROM "Charge" c GROUP BY c."studentId", c."currency" ORDER BY 1, 2`);

beforeAll(async () => {
  pg = await createPg(FIRST);
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School'), ('s2','Other School');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role","createdAt") VALUES
      ('u-dir','s1','The Director','dir@old.test','h','DIRECTOR','2026-01-01'), ('u-bur','s1','The Bursar','bur@old.test','h','BURSAR','2026-01-02'),
      ('u-head','s1','The Head','head@old.test','h','HEAD','2026-01-03'), ('u-tea','s1','Mrs Teacher','tea@old.test','h','TEACHER','2026-01-04'),
      ('u-bur2','s2','Other Bursar','bur2@old.test','h','BURSAR','2026-01-01'), ('u-head2','s2','Other Head','head2@old.test','h','HEAD','2026-01-02');
    INSERT INTO "Level" ("id","schoolId","name","order","category") VALUES ('l1','s1','Form 1',1,'O_LEVEL'), ('x1','s2','Form 1',1,'O_LEVEL');
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream") VALUES ('c1','s1','Form 1 North','l1','North'), ('xc','s2','Form 1 North','x1','North');
    INSERT INTO "AcademicYear" ("id","schoolId","year","startDate","endDate") VALUES ('y1','s1',2026,'2026-01-01','2026-12-31'), ('xy','s2',2026,'2026-01-01','2026-12-31');
    INSERT INTO "AcademicTerm" ("id","schoolId","academicYearId","termNumber","name","startDate","endDate","status") VALUES
      ('t1','s1','y1',1,'Term 1 2026','2026-01-10','2026-04-10','CLOSED'), ('t2','s1','y1',2,'Term 2 2026','2026-05-01','2026-08-01','OPEN'), ('xt','s2','xy',1,'Term 1 2026','2026-01-10','2026-04-10','OPEN');
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate","currentClassId") VALUES
      ('st1','s1','A1','Tendai','Moyo','Tendai Moyo','2026-01-10','c1'), ('st2','s1','A2','Rufaro','Dube','Rufaro Dube','2026-01-10','c1'),
      ('st3','s1','A3','Tino','Ncube','Tino Ncube','2026-01-10','c1'), ('xst','s2','B1','Other','Pupil','Other Pupil','2026-01-10','xc');

    INSERT INTO "FeeStructure" ("id","schoolId","levelId","termId","label","currency","amount") VALUES
      ('fs1','s1','l1','t2','School fees','USD',300.00), ('fs2','s1','l1','t2','SDC levy','USD',45.50), ('fs3','s1',NULL,'t2','Boarding fees','USD',400), ('fs4','s1','l1','t2','School fees','ZIG',1999.99),
      ('xfs','s2','x1','xt','School fees','USD',100);
    INSERT INTO "Charge" ("id","schoolId","studentId","termId","label","currency","amount","issuedAt") VALUES
      ('ch1','s1','st1','t1','School fees','USD',250.00,'2026-01-12'),
      ('ch2','s1','st1','t2','School fees','USD',300.00,'2026-05-02'),
      ('ch3','s1','st1','t2','SDC levy','USD',45.50,'2026-05-02'),
      ('ch4','s1','st1','t2','School fees','ZIG',1999.99,'2026-05-02'),
      ('ch5','s1','st2','t2','School fees','USD',300.00,'2026-05-02'),
      ('ch6','s1','st2','t2','Boarding fees','USD',400.00,'2026-05-02'),
      ('ch7','s1','st3','t2','School fees','USD',300.00,'2026-05-02'),
      ('xch','s2','xst','xt','School fees','USD',100.00,'2026-01-12');
    INSERT INTO "Payment" ("id","schoolId","studentId","currency","amount","method","reference","feeLabel","status","recordedBy","verifiedBy","voidedBy","recordedAt","verifiedAt","voidedAt","paidInZig","zigAmountPaid","exchangeRateUsed") VALUES
      ('pa1','s1','st1','USD',100.00,'CASH',NULL,'School fees','VERIFIED','u-bur','u-head',NULL,'2026-02-01','2026-02-02',NULL,false,NULL,NULL),
      ('pa2','s1','st1','USD',200.00,'ECOCASH','EC123','School fees','VERIFIED','u-bur','u-head',NULL,'2026-05-10','2026-05-11',NULL,false,NULL,NULL),
      ('pa3','s1','st1','USD',20.00,'CASH',NULL,'SDC levy','VERIFIED','u-bur','u-head',NULL,'2026-05-12','2026-05-12',NULL,false,NULL,NULL),
      ('pa4','s1','st1','USD',50.00,'CASH',NULL,'School fees','PENDING','u-bur',NULL,NULL,'2026-05-13',NULL,NULL,false,NULL,NULL),
      ('pa5','s1','st1','USD',75.00,'CASH',NULL,'School fees','VOIDED','u-bur','u-head','u-dir','2026-05-14','2026-05-14','2026-05-15',false,NULL,NULL),
      ('pa6','s1','st2','USD',350.00,'CASH',NULL,'School fees','VERIFIED','u-bur','u-head',NULL,'2026-05-20','2026-05-20',NULL,false,NULL,NULL),
      ('pa7','s1','st2','USD',10.00,'CASH',NULL,'School fees','VOIDED','u-bur',NULL,'u-dir','2026-05-21',NULL,'2026-05-22',false,NULL,NULL),
      ('pa8','s1','st3','USD',100.00,'ZIPIT','ZP9','School fees','VERIFIED','u-bur','u-head',NULL,'2026-05-23','2026-05-23',NULL,true,2700.00,27.00),
      ('xpa','s2','xst','USD',100.00,'CASH',NULL,'School fees','VERIFIED','u-bur2','u-head2',NULL,'2026-01-20','2026-01-20',NULL,false,NULL,NULL);
    INSERT INTO "ExpenseRequest" ("id","schoolId","requestNumber","title","type","department","justification","currency","estimatedTotal","status","requestedById","approvedById","approvedAt","disbursedById","disbursedAt","paymentMethod") VALUES
      ('rq1','s1','REQ-2026-001','Chalk','PURCHASE_ORDER','Science','Low stock','USD',37.00,'DISBURSED','u-tea','u-head','2026-06-02','u-bur','2026-06-03','CASH'),
      ('rq2','s1','REQ-2026-002','Fuel','FUEL','Admin','Trips','USD',80.00,'REJECTED','u-tea',NULL,NULL,NULL,NULL,NULL),
      ('rq3','s1','REQ-2026-003','Desks','PURCHASE_ORDER','Admin','Broken','USD',500.00,'DRAFT','u-tea',NULL,NULL,NULL,NULL,NULL);
    UPDATE "ExpenseRequest" SET "rejectionReason" = 'Not now' WHERE "id" = 'rq2';
    INSERT INTO "ExpenseRequestItem" ("id","requestId","description","quantity","unitPrice","total") VALUES
      ('i1','rq1','Chalk boxes',10,2.50,25.00), ('i2','rq1','Markers',4,3.00,12.00), ('i3','rq2','Fuel',40,2.00,80.00), ('i4','rq3','Desk',10,50.00,500.00);
    INSERT INTO "Expense" ("id","schoolId","category","currency","amount","note","spentOn","recordedBy","status","voidedBy","expenseRequestId") VALUES
      ('ex1','s1','Purchase order','USD',35.00,'Chalk','2026-06-03','u-bur','ACTIVE',NULL,'rq1'),
      ('ex2','s1','Transport','USD',12.00,NULL,'2026-06-10','u-bur','ACTIVE',NULL,NULL),
      ('ex3','s1','Transport','USD',9.99,'Wrong entry','2026-06-11','u-bur','VOIDED','u-dir',NULL);
  `);
  await applyMigration(pg, FIRST);
  await applyMigration(pg, BACKFILL);
}, 180_000);

afterAll(async () => {
  await pg.close();
});

describe('roles, funds and controls', () => {
  it('give roles that already exist the keys of the module, and nobody else anything', async () => {
    const keysOf = async (school: string, role: string) =>
      (await all<{ permissionKey: string }>(`SELECT rp."permissionKey" FROM "RolePermission" rp JOIN "RoleDefinition" r ON r."id" = rp."roleId" WHERE r."schoolId" = $1 AND r."key" = $2 AND rp."permissionKey" LIKE 'finance.%' ORDER BY 1`, [school, role])).map((r) => r.permissionKey);
    for (const school of ['s1', 's2']) {
      expect(await keysOf(school, 'BURSAR')).toEqual(expect.arrayContaining(['finance.payments.record', 'finance.payments.verify', 'finance.requests.disburse', 'finance.refunds.pay']));
      expect(await keysOf(school, 'BURSAR')).not.toContain('finance.refunds.approve');
      expect(await keysOf(school, 'BURSAR')).not.toContain('finance.requests.approve');
      expect(await keysOf(school, 'HEAD')).toEqual(expect.arrayContaining(['finance.payments.verify', 'finance.requests.approve', 'finance.refunds.approve', 'finance.adjustments.approve']));
      expect(await keysOf(school, 'HEAD')).not.toContain('finance.requests.disburse');
      expect(await keysOf(school, 'TEACHER')).toEqual(['finance.requests.create']);
      expect(await keysOf(school, 'ACCOUNTS_CLERK')).not.toContain('finance.payments.verify');
      expect(await keysOf(school, 'LIBRARIAN')).toEqual(['finance.requests.create']);
    }
    expect(await count(`SELECT 1 FROM "Permission" WHERE "key" LIKE 'finance.%'`)).toBeGreaterThanOrEqual(26);
  });

  it('give every school its four funds and its controls, with the older screens retired', async () => {
    for (const s of ['s1', 's2']) {
      expect((await all<{ code: string }>(`SELECT "code" FROM "Fund" WHERE "schoolId" = $1 ORDER BY "sortOrder"`, [s])).map((f) => f.code)).toEqual(['TUITION', 'SDC', 'BOARDING', 'GENERAL']);
      expect((await one<{ legacyRetired: boolean }>(`SELECT "legacyRetired" FROM "FinSettings" WHERE "schoolId" = $1`, [s])).legacyRetired).toBe(true);
    }
  });
});

describe('fees, charges and payments carry over in whole cents', () => {
  it('turns fee lines into cents and sorts them into funds by their label', async () => {
    const rows = await all<{ name: string; fund: string; currency: string; amountCents: number; levelId: string | null }>(
      `SELECT f."name", u."code" AS fund, f."currency"::text AS currency, f."amountCents", f."levelId" FROM "FinFeeItem" f JOIN "Fund" u ON u."id" = f."fundId" WHERE f."schoolId" = 's1' ORDER BY u."sortOrder", f."currency"`);
    expect(rows).toEqual([
      { name: 'School fees', fund: 'TUITION', currency: 'USD', amountCents: 30000, levelId: 'l1' },
      { name: 'School fees', fund: 'TUITION', currency: 'ZIG', amountCents: 199999, levelId: 'l1' },
      { name: 'SDC levy', fund: 'SDC', currency: 'USD', amountCents: 4550, levelId: 'l1' },
      { name: 'Boarding fees', fund: 'BOARDING', currency: 'USD', amountCents: 40000, levelId: null },
    ]);
  });

  it('brings every charge, including those of a closed term, as an integer amount of cents', async () => {
    expect(await count(`SELECT 1 FROM "FinCharge" WHERE "schoolId" = 's1'`)).toBe(7);
    expect((await one<{ n: string }>(`SELECT "amountCents"::text AS n FROM "FinCharge" WHERE "legacyChargeId" = 'ch4'`)).n).toBe('199999');
    expect((await one<{ n: string }>(`SELECT "amountCents"::text AS n FROM "FinCharge" WHERE "legacyChargeId" = 'ch3'`)).n).toBe('4550');
    expect((await one<{ t: string }>(`SELECT "termId" AS t FROM "FinCharge" WHERE "legacyChargeId" = 'ch1'`)).t).toBe('t1'); // the closed term
    expect(await count(`SELECT 1 FROM "FinCharge" WHERE "source" <> 'MIGRATED'`)).toBe(0);
  });

  it('keeps payment statuses, makes receipt numbers, and notes the ZiG tendered on a dollar fee', async () => {
    const s = await all<{ legacyPaymentId: string; status: string; voided: boolean; amountCents: number }>(
      `SELECT p."legacyPaymentId", p."status"::text AS status, EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id") AS voided, p."amountCents" FROM "FinPayment" p WHERE p."schoolId" = 's1' ORDER BY p."legacyPaymentId"`);
    expect(s).toEqual([
      { legacyPaymentId: 'pa1', status: 'VERIFIED', voided: false, amountCents: 10000 },
      { legacyPaymentId: 'pa2', status: 'VERIFIED', voided: false, amountCents: 20000 },
      { legacyPaymentId: 'pa3', status: 'VERIFIED', voided: false, amountCents: 2000 },
      { legacyPaymentId: 'pa4', status: 'PENDING', voided: false, amountCents: 5000 },
      { legacyPaymentId: 'pa5', status: 'VERIFIED', voided: true, amountCents: 7500 },
      { legacyPaymentId: 'pa6', status: 'VERIFIED', voided: false, amountCents: 35000 },
      { legacyPaymentId: 'pa7', status: 'PENDING', voided: true, amountCents: 1000 },
      { legacyPaymentId: 'pa8', status: 'VERIFIED', voided: false, amountCents: 10000 },
    ]);
    expect(await count(`SELECT DISTINCT "receiptNumber" FROM "FinPayment" WHERE "schoolId" = 's1'`)).toBe(8);
    expect((await one<{ receiptNumber: string }>(`SELECT "receiptNumber" FROM "FinPayment" WHERE "legacyPaymentId" = 'pa1'`)).receiptNumber).toMatch(/^LEG-\d{6}$/);
    expect((await one<{ note: string }>(`SELECT "note" FROM "FinPayment" WHERE "legacyPaymentId" = 'pa8'`)).note).toContain('Paid in ZiG 2700.00 at 27.00');
    expect((await one<{ voidedById: string }>(`SELECT v."voidedById" FROM "FinVoid" v JOIN "FinPayment" p ON p."id" = v."paymentId" WHERE p."legacyPaymentId" = 'pa5'`)).voidedById).toBe('u-dir');
  });

  it('leaves every student owing exactly what the older screens showed, in each currency', async () => {
    const before = await legacyBalances();
    const after = await all<{ studentId: string; currency: string; owed: string }>(`
      WITH lines AS (
        SELECT c."id", c."studentId", c."currency"::text AS currency, c."amountCents" AS charged,
               COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId"
                          WHERE a."chargeId" = c."id" AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")), 0) AS paid
          FROM "FinCharge" c WHERE c."schoolId" IN ('s1', 's2') AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."chargeId" = c."id"))
      SELECT "studentId", currency, (sum(charged) - sum(paid))::text AS owed FROM lines GROUP BY 1, 2 ORDER BY 1, 2`);
    // Student 2 paid 350.00 against 700.00 of charges, but 300 of it is tuition and the 400 is boarding: tuition is overpaid by 0 and boarding
    // is untouched, so the two agree only when payments sit in the fund of the charge. The check below is the real invariant: nothing is lost.
    const credit = await all<{ studentId: string; currency: string; credit: string }>(`
      SELECT p."studentId", p."currency"::text AS currency, sum(p."amountCents" - COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0))::text AS credit
        FROM "FinPayment" p WHERE p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id") GROUP BY 1, 2 HAVING sum(p."amountCents" - COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0)) > 0`);
    const creditOf = new Map(credit.map((c) => [`${c.studentId}|${c.currency}`, Number(c.credit)]));
    for (const b of before) {
      const a = after.find((x) => x.studentId === b.studentId && x.currency === b.currency);
      // owed (new) − credit held = what the older screens showed (a negative balance there is credit here)
      expect(Number(a?.owed ?? 0) - (creditOf.get(`${b.studentId}|${b.currency}`) ?? 0), `${b.studentId} ${b.currency}`).toBe(Number(b.owed));
    }
  });

  it('allocates oldest first, never more than a payment holds or a charge owes, and never across funds, currencies or students', async () => {
    expect(await count(`SELECT 1 FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId" JOIN "FinCharge" c ON c."id" = a."chargeId"
                         WHERE p."studentId" <> c."studentId" OR p."currency" <> c."currency" OR p."fundId" <> c."fundId"`)).toBe(0);
    expect(await count(`SELECT 1 FROM "FinPayment" p WHERE (SELECT COALESCE(sum("amountCents"), 0) FROM "FinPaymentAllocation" WHERE "paymentId" = p."id") > p."amountCents"`)).toBe(0);
    expect(await count(`SELECT 1 FROM "FinCharge" c WHERE (SELECT COALESCE(sum("amountCents"), 0) FROM "FinPaymentAllocation" WHERE "chargeId" = c."id") > c."amountCents"`)).toBe(0);
    // the closed-term charge (250.00) is settled first by the first 100.00 and part of the next 200.00
    const rows = await all<{ chargeId: string; n: string }>(`SELECT c."legacyChargeId" AS "chargeId", sum(a."amountCents")::text AS n FROM "FinPaymentAllocation" a JOIN "FinCharge" c ON c."id" = a."chargeId" WHERE c."studentId" = 'st1' AND c."currency" = 'USD' AND c."fundId" = (SELECT "id" FROM "Fund" WHERE "schoolId" = 's1' AND "code" = 'TUITION') GROUP BY 1 ORDER BY 1`);
    expect(rows).toEqual([{ chargeId: 'ch1', n: '25000' }, { chargeId: 'ch2', n: '5000' }]);
    // a payment that is pending, or was voided, settles nothing
    expect(await count(`SELECT 1 FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId" WHERE p."legacyPaymentId" IN ('pa4', 'pa5', 'pa7')`)).toBe(0);
  });
});

describe('requests and expenses carry over', () => {
  it('keeps statuses and lines, and ties the paid request to its expense', async () => {
    const r = await all<{ requestNumber: string; status: string; estimatedCents: number; lines: string }>(
      `SELECT r."requestNumber", r."status"::text AS status, r."estimatedCents", (SELECT count(*) FROM "FinExpenseRequestItem" i WHERE i."requestId" = r."id")::text AS lines FROM "FinExpenseRequest" r WHERE r."schoolId" = 's1' ORDER BY 1`);
    expect(r).toEqual([
      { requestNumber: 'REQ-2026-001', status: 'DISBURSED', estimatedCents: 3700, lines: '2' },
      { requestNumber: 'REQ-2026-002', status: 'REJECTED', estimatedCents: 8000, lines: '1' },
      { requestNumber: 'REQ-2026-003', status: 'DRAFT', estimatedCents: 50000, lines: '1' },
    ]);
    const paid = await one<{ requestNumber: string; amountCents: number; source: string }>(`SELECT r."requestNumber", e."amountCents", e."source"::text AS source FROM "FinExpense" e JOIN "FinExpenseRequest" r ON r."id" = e."requestId"`);
    expect(paid).toEqual({ requestNumber: 'REQ-2026-001', amountCents: 3500, source: 'MIGRATED' });
    expect((await one<{ reason: string }>(`SELECT "rejectionReason" AS reason FROM "FinExpenseRequest" WHERE "legacyRequestId" = 'rq2'`)).reason).toBe('Not now');
  });

  it('brings every expense in cents, and keeps a voided one voided', async () => {
    expect(await count(`SELECT 1 FROM "FinExpense" WHERE "schoolId" = 's1'`)).toBe(3);
    expect((await one<{ n: string }>(`SELECT "amountCents"::text AS n FROM "FinExpense" WHERE "legacyExpenseId" = 'ex3'`)).n).toBe('999');
    expect(await count(`SELECT 1 FROM "FinVoid" v JOIN "FinExpense" e ON e."id" = v."expenseId" WHERE e."legacyExpenseId" = 'ex3' AND v."voidedById" = 'u-dir'`)).toBe(1);
    expect(await count(`SELECT 1 FROM "FinVoid" v JOIN "FinExpense" e ON e."id" = v."expenseId" WHERE e."legacyExpenseId" <> 'ex3'`)).toBe(0);
  });
});

describe('the old tables stay and other schools are untouched', () => {
  it('does not change the older tables', async () => {
    expect(await count(`SELECT 1 FROM "Charge"`)).toBe(8);
    expect(await count(`SELECT 1 FROM "Payment"`)).toBe(9);
    expect(await count(`SELECT 1 FROM "Payment" WHERE "status" = 'VOIDED'`)).toBe(2);
    expect(await count(`SELECT 1 FROM "Expense"`)).toBe(3);
    expect(await count(`SELECT 1 FROM "FeeStructure"`)).toBe(5);
  });

  it('keeps each school’s money apart', async () => {
    expect(await count(`SELECT 1 FROM "FinCharge" c JOIN "FinPayment" p ON p."studentId" = c."studentId" WHERE c."schoolId" <> p."schoolId"`)).toBe(0);
    expect(await count(`SELECT 1 FROM "FinCharge" WHERE "schoolId" = 's2'`)).toBe(1);
    expect(await count(`SELECT 1 FROM "FinPayment" WHERE "schoolId" = 's2'`)).toBe(1);
    expect((await one<{ n: string }>(`SELECT sum(a."amountCents")::text AS n FROM "FinPaymentAllocation" a WHERE a."schoolId" = 's2'`)).n).toBe('10000');
  });
});

describe('running the data step again changes nothing', () => {
  it('is idempotent', async () => {
    const snapshot = async () => ({
      funds: await count(`SELECT 1 FROM "Fund"`), items: await count(`SELECT 1 FROM "FinFeeItem"`), charges: await count(`SELECT 1 FROM "FinCharge"`), payments: await count(`SELECT 1 FROM "FinPayment"`),
      allocations: await count(`SELECT 1 FROM "FinPaymentAllocation"`), voids: await count(`SELECT 1 FROM "FinVoid"`), requests: await count(`SELECT 1 FROM "FinExpenseRequest"`),
      lines: await count(`SELECT 1 FROM "FinExpenseRequestItem"`), expenses: await count(`SELECT 1 FROM "FinExpense"`), grants: await count(`SELECT 1 FROM "RolePermission"`),
    });
    const before = await snapshot();
    await applyMigration(pg, BACKFILL);
    expect(await snapshot()).toEqual(before);
  });
});
