// The Facilities & Operations tables and the rules the database keeps by itself: nothing is deleted, stock and wallets never go
// below zero, every receipt links to a request or has a reason, a write-off needs a reason and an approver, a waived fine carries a
// reason, an asset is disposed of once, a bed or a book is held by one person at a time, and no row points into another school.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createPg } from '../helpers/test-db';

let pg: PGlite;
const q = async (sql: string) => (await pg.query(sql)).rows as Record<string, unknown>[];
/** Runs a statement that the database must refuse, and returns the message. */
async function refused(sql: string): Promise<string> {
  try {
    await pg.exec(sql);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('The database accepted: ' + sql.slice(0, 120));
}

const TABLES = [
  'FacSettings', 'FacSequence', 'FacLedgerEntry', 'FacHostel', 'FacRoom', 'FacBed', 'FacBedAllocation', 'FacRollCall', 'FacRollCallEntry',
  'FacInspection', 'FacInspectionItem', 'FacExeat', 'FacVisitorLog', 'FacSickBayVisit', 'FacMedicationRound', 'FacMedicationDose', 'FacWallet',
  'FacWalletEntry', 'FacTuckShopSale', 'FacTuckShopSaleLine', 'FacTuckShopCashUp', 'FacBookTitle', 'FacBookCopy', 'FacLibraryMember', 'FacLoan',
  'FacReservation', 'FacTextbookSet', 'FacTextbookIssue', 'FacStocktake', 'FacStocktakeScan', 'FacRoute', 'FacStop', 'FacStudentRoute', 'FacVehicle',
  'FacVehicleDocument', 'FacDriver', 'FacDriverDocument', 'FacTrip', 'FacTripPassenger', 'FacFuelLog', 'FacVehicleBooking', 'FacStore', 'FacStockItem',
  'FacStockLot', 'FacStockMovement', 'FacStockCount', 'FacStockCountLine', 'FacAssetCategory', 'FacAsset', 'FacAssetTransfer', 'FacMaintenanceSchedule',
  'FacMaintenanceJob', 'FacAssetDisposal', 'FacVerificationRound', 'FacVerificationScan',
];

// Rows that are only ever added: no updatedAt.
const APPEND_ONLY = ['FacWalletEntry', 'FacStockMovement', 'FacTuckShopSaleLine', 'FacStocktakeScan', 'FacVerificationScan'];

const KEYS = [
  'facilities.assets.view', 'facilities.library.view', 'facilities.inventory.view',
  'facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect',
  'facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout', 'facilities.visitors.log',
  'facilities.sickbay.record', 'facilities.sickbay.view',
  'facilities.wallets.manage', 'facilities.wallets.view', 'facilities.tuckshop.sell', 'facilities.tuckshop.cashup',
  'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue',
  'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign',
  'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff',
  'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify',
];

beforeAll(async () => {
  pg = await createPg();
  await pg.exec(`INSERT INTO "School" ("id", "name") VALUES ('s1', 'Alpha'), ('s2', 'Beta')`);
  for (const [id, school] of [['u1', 's1'], ['u2', 's1'], ['u3', 's2']]) {
    await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role") VALUES ('${id}', '${school}', 'User ${id}', '${id}@x.test', 'x', 'TEACHER')`);
  }
  for (const [id, school] of [['st1', 's1'], ['st2', 's1'], ['st3', 's2']]) {
    await pg.exec(`INSERT INTO "Student" ("id", "schoolId", "admissionNumber", "firstName", "surname", "fullName", "admissionDate", "updatedAt")
      VALUES ('${id}', '${school}', 'A-${id}', 'Ann', '${id}', 'Ann ${id}', '2026-01-10', now())`);
  }
  await pg.exec(`INSERT INTO "FacStore" ("id", "schoolId", "name") VALUES ('store1', 's1', 'Main store'), ('store2', 's1', 'Kitchen'), ('store3', 's2', 'Main store')`);
  await pg.exec(`INSERT INTO "FacStockItem" ("id", "schoolId", "name", "category") VALUES ('item1', 's1', 'Maize meal', 'FOOD'), ('item3', 's2', 'Maize meal', 'FOOD')`);
});
afterAll(async () => { await pg?.close(); });

describe('Facilities migration', () => {
  it('creates every table, each with row-level security and a school policy', async () => {
    const rows = await q(`SELECT c.relname, c.relrowsecurity AND c.relforcerowsecurity AS rls,
        EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'school_isolation') AS policy
      FROM pg_class c WHERE c.relname LIKE 'Fac%' AND c.relkind = 'r'`);
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const r of rows) {
      expect(r.rls, `${r.relname} rls`).toBe(true);
      expect(r.policy, `${r.relname} policy`).toBe(true);
    }
  });

  it('every table has schoolId, createdAt (and updatedAt unless it is only ever added to) and an audit trigger (the row-change audit)', async () => {
    const cols = await q(`SELECT table_name, array_agg(column_name::text) AS cols FROM information_schema.columns WHERE table_name LIKE 'Fac%' GROUP BY table_name`);
    for (const c of cols) {
      expect(c.cols as string[], String(c.table_name)).toEqual(expect.arrayContaining(['schoolId', 'createdAt']));
      // Only rows that are never edited have no updatedAt.
      if (!APPEND_ONLY.includes(String(c.table_name))) expect(c.cols as string[], String(c.table_name)).toContain('updatedAt');
    }
    const audited = new Set((await q(`SELECT event_object_table AS t FROM information_schema.triggers WHERE trigger_name LIKE 'audit\\_Fac%'`)).map((r) => r.t));
    for (const t of TABLES.filter((x) => x !== 'FacSequence')) expect(audited.has(t), `${t} audited`).toBe(true);
  });

  it('seeds every permission key, and gives none of them to a role by itself', async () => {
    const rows = await q(`SELECT "key" FROM "Permission" WHERE "key" LIKE 'facilities.%'`);
    for (const k of KEYS) expect(rows.map((r) => r.key), k).toContain(k);
    expect((await q(`SELECT count(*)::int AS n FROM "RolePermission" WHERE "permissionKey" = ANY(ARRAY['${KEYS.join("','")}'])`))[0]!.n).toBe(0);
  });

  it('audit entries for these tables belong to Facilities & Operations', async () => {
    const r = await q(`SELECT audit_module('FacStockMovement') AS a, audit_module('FacAsset') AS b, audit_module('Employee') AS c`);
    expect(r[0]).toEqual({ a: 'facilities', b: 'facilities', c: 'hr' });
  });
});

describe('records are never deleted', () => {
  it('refuses to delete a store, an item or a school-owned facilities row', async () => {
    expect(await refused(`DELETE FROM "FacStore" WHERE "id" = 'store2'`)).toMatch(/never deleted/);
    expect(await refused(`DELETE FROM "FacStockItem" WHERE "id" = 'item1'`)).toMatch(/never deleted/);
  });
});

describe('stock', () => {
  it('a receipt links to a purchase request or says why there is none', async () => {
    const m = (extra: string) => `INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById" ${extra.split('|')[0]})
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', 'IN', 50, 'u1' ${extra.split('|')[1] ?? ''})`;
    expect(await refused(m(''))).toMatch(/FacStockMovement_receipt/);
    expect(await refused(m(', "reason"|, \'  \''))).toMatch(/FacStockMovement_receipt/);
    await pg.exec(m(', "reason"|, \'Opening stock at start of year\''));
    expect((await q(`SELECT sum("qty") AS n FROM "FacStockMovement" WHERE "itemId" = 'item1'`))[0]!.n).toBe(50);
  });

  it('stock can never go below zero, in total or in a batch', async () => {
    const out = (qty: number) => `INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById", "department")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', 'ISSUE', ${-qty}, 'u1', 'Kitchen')`;
    expect(await refused(out(51))).toMatch(/Not enough stock/);
    await pg.exec(out(50));
    expect((await q(`SELECT sum("qty") AS n FROM "FacStockMovement" WHERE "itemId" = 'item1'`))[0]!.n).toBe(0);
    expect(await refused(out(1))).toMatch(/Not enough stock/);
    // Another store has none of it either.
    expect(await refused(`INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById", "department")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store2', 'ISSUE', -1, 'u1', 'Kitchen')`)).toMatch(/Not enough stock/);
  });

  it('a lot cannot be drawn below zero even when the store has stock from another lot', async () => {
    await pg.exec(`INSERT INTO "FacStockLot" ("id", "schoolId", "itemId", "storeId", "expiry") VALUES ('lotA', 's1', 'item1', 'store1', '2027-01-01'), ('lotB', 's1', 'item1', 'store1', '2028-01-01')`);
    const into = (lot: string, qty: number) => `INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "lotId", "type", "qty", "createdById", "reason")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', '${lot}', 'IN', ${qty}, 'u1', 'Donation from the church')`;
    await pg.exec(into('lotA', 5)); await pg.exec(into('lotB', 20));
    expect(await refused(`INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "lotId", "type", "qty", "createdById", "department")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', 'lotA', 'ISSUE', -6, 'u1', 'Kitchen')`)).toMatch(/Not enough stock in that batch/);
  });

  it('a write-off needs a reason, a kind and the approver; without them nothing is recorded', async () => {
    const w = (cols: string, vals: string) => `INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById" ${cols})
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', 'WRITEOFF', -2, 'u1' ${vals})`;
    expect(await refused(w('', ''))).toMatch(/FacStockMovement_writeoff/);
    expect(await refused(w(', "writeoffReason", "reason"', ", 'EXPIRED', 'Past its date'"))).toMatch(/FacStockMovement_writeoff/); // no approver
    expect(await refused(w(', "writeoffReason", "reason", "approvedById", "approvedAt"', ", 'EXPIRED', '', 'u2', now()"))).toMatch(/FacStockMovement_writeoff/); // no reason
    await pg.exec(w(', "writeoffReason", "reason", "approvedById", "approvedAt"', ", 'EXPIRED', 'Past its date', 'u2', now()"));
  });

  it('movements are only added to: they cannot be edited, and a sign that does not match the type is refused', async () => {
    expect(await refused(`UPDATE "FacStockMovement" SET "qty" = 1000 WHERE "itemId" = 'item1'`)).toMatch(/only be added/);
    expect(await refused(`INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById", "reason")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store1', 'IN', -3, 'u1', 'x y z')`)).toMatch(/FacStockMovement_values/);
  });

  it('a stock item cannot be stored with a price but no currency', async () => {
    expect(await refused(`INSERT INTO "FacStockItem" ("id", "schoolId", "name", "category", "priceCents") VALUES ('bad', 's1', 'Pen', 'STATIONERY', 50)`)).toMatch(/FacStockItem_values/);
  });
});

describe('same school', () => {
  it('a movement cannot point at another school\'s store or item', async () => {
    expect(await refused(`INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById", "reason")
      VALUES (gen_random_uuid()::text, 's1', 'item1', 'store3', 'IN', 1, 'u1', 'Donation')`)).toMatch(/Cross-school/);
    expect(await refused(`INSERT INTO "FacStockMovement" ("id", "schoolId", "itemId", "storeId", "type", "qty", "createdById", "reason")
      VALUES (gen_random_uuid()::text, 's1', 'item3', 'store1', 'IN', 1, 'u1', 'Donation')`)).toMatch(/Cross-school/);
  });

  it('a bed allocation, a loan and a wallet cannot point at another school\'s learner', async () => {
    await pg.exec(`INSERT INTO "FacHostel" ("id", "schoolId", "name", "gender") VALUES ('h1', 's1', 'Girls hostel', 'F')`);
    await pg.exec(`INSERT INTO "FacRoom" ("id", "schoolId", "hostelId", "name", "capacity") VALUES ('r1', 's1', 'h1', 'Room 1', 4)`);
    await pg.exec(`INSERT INTO "FacBed" ("id", "schoolId", "roomId", "number") VALUES ('b1', 's1', 'r1', '1'), ('b2', 's1', 'r1', '2')`);
    expect(await refused(`INSERT INTO "FacWallet" ("id", "schoolId", "studentId", "currency") VALUES ('w-bad', 's1', 'st3', 'USD')`)).toMatch(/Cross-school/);
    expect(await refused(`INSERT INTO "FacHostel" ("id", "schoolId", "name", "gender", "boardingMasterId") VALUES ('h-bad', 's1', 'Boys', 'M', 'u3')`)).toMatch(/Cross-school/);
  });
});

describe('hostel', () => {
  it('a learner has one open bed and a bed has one open learner; a move closes the old allocation', async () => {
    await pg.exec(`INSERT INTO "AcademicYear" ("id", "schoolId", "year", "startDate", "endDate") VALUES ('y1', 's1', 2026, '2026-01-01', '2026-12-31')`);
    await pg.exec(`INSERT INTO "AcademicTerm" ("id", "schoolId", "academicYearId", "termNumber", "name", "startDate", "endDate") VALUES ('term1', 's1', 'y1', 1, 'Term 1 2026', '2026-01-12', '2026-04-10')`);
    const term = 'term1';
    const alloc = (id: string, student: string, bed: string) => `INSERT INTO "FacBedAllocation" ("id", "schoolId", "studentId", "bedId", "termId", "fromDate", "allocatedById")
      VALUES ('${id}', 's1', '${student}', '${bed}', '${term}', '2026-01-12', 'u1')`;
    await pg.exec(alloc('a1', 'st1', 'b1'));
    expect(await refused(alloc('a2', 'st1', 'b2'))).toMatch(/FacBedAllocation_student_open/);
    expect(await refused(alloc('a3', 'st2', 'b1'))).toMatch(/FacBedAllocation_bed_open/);
    await pg.exec(`UPDATE "FacBedAllocation" SET "toDate" = '2026-02-01' WHERE "id" = 'a1'`);
    await pg.exec(alloc('a4', 'st1', 'b2'));
  });
});

describe('wallets', () => {
  it('a wallet holds one currency, is never overdrawn, and its balance is the sum of its entries', async () => {
    await pg.exec(`INSERT INTO "FacWallet" ("id", "schoolId", "studentId", "currency") VALUES ('w1', 's1', 'st1', 'USD')`);
    const e = (type: string, cents: number, currency = 'USD', extra = '') => `INSERT INTO "FacWalletEntry" ("id", "schoolId", "walletId", "currency", "amountCents", "type", "note", "createdById" ${extra.split('|')[0] ?? ''})
      VALUES (gen_random_uuid()::text, 's1', 'w1', '${currency}', ${cents}, '${type}', 'Cash from mum', 'u1' ${extra.split('|')[1] ?? ''})`;
    await pg.exec(e('DEPOSIT', 1000));
    expect(await refused(e('DEPOSIT', 500, 'ZIG'))).toMatch(/never mixed/);
    expect(await refused(e('WITHDRAWAL', -1001))).toMatch(/Not enough pocket money/);
    await pg.exec(e('WITHDRAWAL', -400));
    expect((await q(`SELECT sum("amountCents")::int AS n FROM "FacWalletEntry" WHERE "walletId" = 'w1'`))[0]!.n).toBe(600);
    expect(await refused(e('DEPOSIT', -5))).toMatch(/FacWalletEntry_sign/);
    expect(await refused(`UPDATE "FacWalletEntry" SET "amountCents" = 99999`)).toMatch(/only be added/);
    expect(await refused(`INSERT INTO "FacWallet" ("id", "schoolId", "studentId", "currency") VALUES ('w1b', 's1', 'st1', 'USD')`)).toMatch(/duplicate|unique/i);
  });

  it('a purchase must name the sale it belongs to', async () => {
    expect(await refused(`INSERT INTO "FacWalletEntry" ("id", "schoolId", "walletId", "currency", "amountCents", "type", "createdById")
      VALUES (gen_random_uuid()::text, 's1', 'w1', 'USD', -50, 'PURCHASE', 'u1')`)).toMatch(/FacWalletEntry_sign/);
  });
});

describe('library', () => {
  beforeAll(async () => {
    await pg.exec(`INSERT INTO "FacBookTitle" ("id", "schoolId", "title") VALUES ('t1', 's1', 'Physics Form 3')`);
    await pg.exec(`INSERT INTO "FacBookCopy" ("id", "schoolId", "titleId", "accessionNo", "barcode") VALUES ('c1', 's1', 't1', 'ACC-1', 'BC-1'), ('c2', 's1', 't1', 'ACC-2', 'BC-2')`);
    await pg.exec(`INSERT INTO "FacLibraryMember" ("id", "schoolId", "type", "studentId") VALUES ('m1', 's1', 'LEARNER', 'st1'), ('m2', 's1', 'LEARNER', 'st2')`);
  });

  it('accession numbers and barcodes are unique within a school', async () => {
    expect(await refused(`INSERT INTO "FacBookCopy" ("id", "schoolId", "titleId", "accessionNo", "barcode") VALUES ('c3', 's1', 't1', 'ACC-1', 'BC-9')`)).toMatch(/unique|duplicate/i);
    expect(await refused(`INSERT INTO "FacBookCopy" ("id", "schoolId", "titleId", "accessionNo", "barcode") VALUES ('c4', 's1', 't1', 'ACC-9', 'BC-1')`)).toMatch(/unique|duplicate/i);
  });

  it('a copy is on one loan at a time; after the return it can go out again', async () => {
    const loan = (id: string, member: string) => `INSERT INTO "FacLoan" ("id", "schoolId", "copyId", "memberId", "outAt", "dueAt", "checkedOutById")
      VALUES ('${id}', 's1', 'c1', '${member}', '2026-03-01', '2026-03-15', 'u1')`;
    await pg.exec(loan('l1', 'm1'));
    expect(await refused(loan('l2', 'm2'))).toMatch(/FacLoan_copy_open/);
    await pg.exec(`UPDATE "FacLoan" SET "returnedAt" = '2026-03-20', "fineCents" = 150, "fineCurrency" = 'USD' WHERE "id" = 'l1'`);
    await pg.exec(loan('l2', 'm2'));
  });

  it('a fine in cents needs a currency, and a waived fine needs a reason', async () => {
    expect(await refused(`UPDATE "FacLoan" SET "fineCents" = 100 WHERE "id" = 'l2'`)).toMatch(/FacLoan_fine_currency/);
    expect(await refused(`UPDATE "FacLoan" SET "waivedById" = 'u1' WHERE "id" = 'l1'`)).toMatch(/FacLoan_waive/);
    expect(await refused(`UPDATE "FacLoan" SET "waivedById" = 'u1', "waiveReason" = ' ' WHERE "id" = 'l1'`)).toMatch(/FacLoan_waive/);
    await pg.exec(`UPDATE "FacLoan" SET "waivedById" = 'u1', "waiveReason" = 'Book was returned late because of the strike' WHERE "id" = 'l1'`);
  });

  it('a textbook copy is held by one learner at a time, and a returned book cannot be marked missing', async () => {
    const issue = (id: string, student: string) => `INSERT INTO "FacTextbookIssue" ("id", "schoolId", "copyId", "studentId", "issuedById") VALUES ('${id}', 's1', 'c2', '${student}', 'u1')`;
    await pg.exec(issue('i1', 'st1'));
    expect(await refused(issue('i2', 'st2'))).toMatch(/FacTextbookIssue_copy_open/);
    expect(await refused(`UPDATE "FacTextbookIssue" SET "returnedAt" = now(), "missingAt" = now() WHERE "id" = 'i1'`)).toMatch(/FacTextbookIssue_values/);
  });

  it('a member is a learner or a staff member, not both and not neither', async () => {
    expect(await refused(`INSERT INTO "FacLibraryMember" ("id", "schoolId", "type") VALUES ('m-x', 's1', 'STAFF')`)).toMatch(/FacLibraryMember_who/);
  });
});

describe('assets', () => {
  beforeAll(async () => {
    await pg.exec(`INSERT INTO "FacAssetCategory" ("id", "schoolId", "name", "depreciationYears") VALUES ('cat1', 's1', 'ICT', 3)`);
    await pg.exec(`INSERT INTO "FacAsset" ("id", "schoolId", "tag", "name", "categoryId", "location") VALUES ('as1', 's1', 'AST-00001', 'Laptop', 'cat1', 'Staffroom')`);
  });

  it('an asset is disposed of once', async () => {
    const d = (id: string) => `INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "recordedById")
      VALUES ('${id}', 's1', 'as1', 'SCRAPPED', 'Beyond repair', '2026-05-01', 'u1', 'u2')`;
    await pg.exec(d('d1'));
    expect(await refused(d('d2'))).toMatch(/unique|duplicate/i);
  });

  it('tags are unique within a school; a disposal needs a reason and two different approvers', async () => {
    expect(await refused(`INSERT INTO "FacAsset" ("id", "schoolId", "tag", "name", "categoryId", "location") VALUES ('as2', 's1', 'AST-00001', 'Desk', 'cat1', 'Room 1')`)).toMatch(/unique|duplicate/i);
    await pg.exec(`INSERT INTO "FacAsset" ("id", "schoolId", "tag", "name", "categoryId", "location") VALUES ('as3', 's1', 'AST-00003', 'Bus', 'cat1', 'Yard')`);
    expect(await refused(`INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "ownerApprovedById", "recordedById")
      VALUES ('d3', 's1', 'as3', 'SOLD', 'Sold at auction', '2026-05-01', 'u1', 'u1', 'u2')`)).toMatch(/FacAssetDisposal_values/);
  });
});

describe('transport', () => {
  it('a vehicle needs seats and a trip needs a route or a booking and a sensible odometer', async () => {
    expect(await refused(`INSERT INTO "FacVehicle" ("id", "schoolId", "registration", "make", "seats") VALUES ('v-bad', 's1', 'ABC 123', 'Toyota', 0)`)).toMatch(/FacVehicle_values/);
    await pg.exec(`INSERT INTO "FacVehicle" ("id", "schoolId", "registration", "make", "seats") VALUES ('v1', 's1', 'ABC 123', 'Toyota', 30)`);
    expect(await refused(`INSERT INTO "FacTrip" ("id", "schoolId", "vehicleId", "driverId", "date", "recordedById") VALUES ('trip-x', 's1', 'v1', 'nobody', '2026-03-01', 'u1')`)).toMatch(/foreign key|Cross-school|FacTrip_values/i);
  });
});

describe('exeats and visitors', () => {
  it('an exeat comes back after it went out, has a reason, and is approved before it is signed out', async () => {
    const x = (cols: string, vals: string) => `INSERT INTO "FacExeat" ("id", "schoolId", "studentId", "type", "outAt", "dueBackAt", "reason", "collectedBy", "requestedById" ${cols})
      VALUES (gen_random_uuid()::text, 's1', 'st1', 'WEEKEND', '2026-03-06 15:00', '2026-03-08 17:00', 'Family function', '{"guardianId":"g1"}', 'u1' ${vals})`;
    await pg.exec(x('', ''));
    expect(await refused(x('', '').replace('2026-03-08 17:00', '2026-03-06 14:00'))).toMatch(/FacExeat_times/);
    expect(await refused(x('', '').replace('Family function', ' '))).toMatch(/FacExeat_reason/);
    expect(await refused(x(', "status"', ", 'SIGNED_OUT'"))).toMatch(/FacExeat_status/);
  });

  it('a visitor is a guardian on record or someone the boarding master approved', async () => {
    expect(await refused(`INSERT INTO "FacVisitorLog" ("id", "schoolId", "studentId", "visitorName", "timeIn", "loggedById") VALUES (gen_random_uuid()::text, 's1', 'st1', 'Uncle Joe', now(), 'u1')`)).toMatch(/FacVisitorLog_who/);
    await pg.exec(`INSERT INTO "FacVisitorLog" ("id", "schoolId", "studentId", "visitorName", "timeIn", "loggedById", "approvedById") VALUES (gen_random_uuid()::text, 's1', 'st1', 'Uncle Joe', now(), 'u1', 'u2')`);
  });
});
