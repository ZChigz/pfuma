// The library data step: the first library tables (books, copies, members, loans) are copied into the Facilities library without losing
// anything, a second run changes nothing, and the rules of the new library hold for the copied rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const q = async (sql: string) => (await pg.query(sql)).rows as Record<string, unknown>[];
const BACKFILL = '20261108000100_facilities_library_backfill';

beforeAll(async () => {
  pg = await createPg(BACKFILL);
  await pg.exec(`INSERT INTO "School" ("id", "name") VALUES ('s1', 'Alpha'), ('s2', 'Beta')`);
  await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role") VALUES ('u1', 's1', 'Mrs Teacher', 'u1@x.test', 'x', 'LIBRARIAN'), ('u2', 's2', 'Mr Other', 'u2@x.test', 'x', 'LIBRARIAN')`);
  await pg.exec(`INSERT INTO "Employee" ("id", "schoolId", "employeeNo", "userId", "firstName", "surname", "jobTitle", "startDate", "createdById", "updatedAt") VALUES ('e1', 's1', 'EMP-0001', 'u1', 'Mrs', 'Teacher', 'Teacher', '2020-01-01', 'u1', now())`);
  for (const [id, school] of [['st1', 's1'], ['st2', 's1'], ['st3', 's2']]) {
    await pg.exec(`INSERT INTO "Student" ("id", "schoolId", "admissionNumber", "firstName", "surname", "fullName", "admissionDate", "updatedAt") VALUES ('${id}', '${school}', 'A-${id}', 'Ann', '${id}', 'Ann ${id}', '2026-01-10', now())`);
  }
  await pg.exec(`INSERT INTO "Book" ("id", "schoolId", "title", "author", "isbn", "shelfLocation", "replacementCost", "replacementCurrency") VALUES
    ('b1', 's1', 'Algebra', 'Smith', '9780000000001', 'M-1', 12.50, 'USD'), ('b2', 's1', 'Poems', 'Dube', NULL, NULL, NULL, 'USD'), ('b3', 's2', 'Algebra', 'Smith', NULL, NULL, 8, 'ZIG')`);
  await pg.exec(`INSERT INTO "BookCopy" ("id", "schoolId", "bookId", "accessionNumber", "condition", "status") VALUES
    ('c1', 's1', 'b1', 'ACC-00005', 'NEW', 'BORROWED'), ('c2', 's1', 'b1', 'ACC-00071', 'FAIR', 'AVAILABLE'), ('c3', 's1', 'b2', 'P-1', 'DAMAGED', 'DAMAGED'),
    ('c4', 's1', 'b2', 'P-2', 'GOOD', 'LOST'), ('c5', 's2', 'b3', 'ACC-00001', 'GOOD', 'AVAILABLE')`);
  await pg.exec(`INSERT INTO "LibraryMember" ("id", "schoolId", "memberType", "studentId", "borrowingSuspended", "suspensionReason") VALUES ('m1', 's1', 'STUDENT', 'st1', false, NULL), ('m2', 's1', 'STUDENT', 'st2', true, NULL)`);
  await pg.exec(`INSERT INTO "LibraryMember" ("id", "schoolId", "memberType", "userId") VALUES ('m3', 's1', 'STAFF', 'u1')`);
  await pg.exec(`INSERT INTO "Borrowing" ("id", "schoolId", "copyId", "memberId", "checkoutDate", "dueDate", "returnDate", "fineAmount", "conditionOnReturn") VALUES
    ('l1', 's1', 'c1', 'm1', '2026-09-01', '2026-09-15', NULL, 0, NULL),
    ('l2', 's1', 'c2', 'm2', '2026-08-01', '2026-08-15', '2026-08-20', 1.25, 'FAIR'),
    ('l3', 's1', 'c2', 'm3', '2026-09-02', '2026-10-02', '2026-09-30', 0, 'GOOD')`);
});
afterAll(async () => { await pg?.close(); });

describe('library data step', () => {
  it('copies titles, copies, members and loans', async () => {
    await applyMigration(pg, BACKFILL);
    const titles = await q(`SELECT "title", "authors", "replacementCents", "currency", "shelfLocation", "legacyBookId" FROM "FacBookTitle" ORDER BY "schoolId", "title"`);
    expect(titles).toEqual([
      { title: 'Algebra', authors: ['Smith'], replacementCents: 1250, currency: 'USD', shelfLocation: 'M-1', legacyBookId: 'b1' },
      { title: 'Poems', authors: ['Dube'], replacementCents: null, currency: null, shelfLocation: null, legacyBookId: 'b2' },
      { title: 'Algebra', authors: ['Smith'], replacementCents: 800, currency: 'ZIG', shelfLocation: null, legacyBookId: 'b3' },
    ]);
    const copies = await q(`SELECT "accessionNo", "barcode", "condition", "status", "costCents", "currency" FROM "FacBookCopy" ORDER BY "legacyCopyId"`);
    expect(copies).toEqual([
      { accessionNo: 'ACC-00005', barcode: 'ACC-00005', condition: 'NEW', status: 'ON_LOAN', costCents: 1250, currency: 'USD' },
      { accessionNo: 'ACC-00071', barcode: 'ACC-00071', condition: 'WORN', status: 'AVAILABLE', costCents: 1250, currency: 'USD' },
      { accessionNo: 'P-1', barcode: 'P-1', condition: 'DAMAGED', status: 'WITHDRAWN', costCents: 0, currency: 'USD' },
      { accessionNo: 'P-2', barcode: 'P-2', condition: 'GOOD', status: 'LOST', costCents: 0, currency: 'USD' },
      { accessionNo: 'ACC-00001', barcode: 'ACC-00001', condition: 'GOOD', status: 'AVAILABLE', costCents: 800, currency: 'ZIG' },
    ]);
    const members = await q(`SELECT "type", "studentId", "employeeId", "suspended", "suspendedReason" FROM "FacLibraryMember" ORDER BY "type", "studentId"`);
    expect(members).toEqual([
      { type: 'LEARNER', studentId: 'st1', employeeId: null, suspended: false, suspendedReason: null },
      { type: 'LEARNER', studentId: 'st2', employeeId: null, suspended: true, suspendedReason: 'Suspended before the library moved to Facilities' },
      { type: 'STAFF', studentId: null, employeeId: 'e1', suspended: false, suspendedReason: null },
    ]);
  });

  it('keeps every loan, with its fine in cents, and the open loan on its copy', async () => {
    const loans = await q(`SELECT c."accessionNo", l."returnedAt" IS NULL AS open, l."fineCents", l."fineCurrency" FROM "FacLoan" l JOIN "FacBookCopy" c ON c."id" = l."copyId" ORDER BY l."outAt"`);
    expect(loans).toEqual([
      { accessionNo: 'ACC-00071', open: false, fineCents: 125, fineCurrency: 'USD' },
      { accessionNo: 'ACC-00005', open: true, fineCents: 0, fineCurrency: null },
      { accessionNo: 'ACC-00071', open: false, fineCents: 0, fineCurrency: null },
    ]);
  });

  it('carries the accession counter on after the highest number, per school', async () => {
    const seq = await q(`SELECT "schoolId", "nextNumber" FROM "FacSequence" WHERE "key" = 'ACC' ORDER BY "schoolId"`);
    expect(seq).toEqual([{ schoolId: 's1', nextNumber: 72 }, { schoolId: 's2', nextNumber: 2 }]);
  });

  it('running it again changes nothing', async () => {
    const count = async () => (await q(`SELECT (SELECT count(*) FROM "FacBookTitle")::int AS t, (SELECT count(*) FROM "FacBookCopy")::int AS c, (SELECT count(*) FROM "FacLibraryMember")::int AS m, (SELECT count(*) FROM "FacLoan")::int AS l`))[0];
    const before = await count();
    await pg.exec(fs.readFileSync(path.resolve(__dirname, `../../prisma/migrations/${BACKFILL}/migration.sql`), 'utf8'));
    expect(await count()).toEqual(before);
    expect(before).toEqual({ t: 3, c: 5, m: 3, l: 3 });
  });

  it('the rules of the new library hold for the copied rows', async () => {
    // The copy that is out cannot be lent again, and a second open loan on it is refused.
    await expect(pg.exec(`INSERT INTO "FacLoan" ("id", "schoolId", "copyId", "memberId", "outAt", "dueAt", "checkedOutById") SELECT 'x1', 's1', c."id", m."id", now(), now() + interval '1 day', 'u1' FROM "FacBookCopy" c, "FacLibraryMember" m WHERE c."accessionNo" = 'ACC-00005' AND m."studentId" = 'st2'`)).rejects.toThrow(/FacLoan_copy_open/);
    // A lost copy is never lent again.
    await expect(pg.exec(`INSERT INTO "FacLoan" ("id", "schoolId", "copyId", "memberId", "outAt", "dueAt", "checkedOutById") SELECT 'x2', 's1', c."id", m."id", now(), now() + interval '1 day', 'u1' FROM "FacBookCopy" c, "FacLibraryMember" m WHERE c."accessionNo" = 'P-2' AND m."studentId" = 'st1'`)).rejects.toThrow(/lost copy cannot be lent/);
    // A book is renewed once.
    await expect(pg.exec(`UPDATE "FacLoan" SET "renewedCount" = 2 WHERE "returnedAt" IS NULL`)).rejects.toThrow(/FacLoan_renewed_once/);
    // A fine belongs to a closed loan.
    await expect(pg.exec(`UPDATE "FacLoan" SET "fineCents" = 100, "fineCurrency" = 'USD' WHERE "returnedAt" IS NULL`)).rejects.toThrow(/FacLoan_fine_closed/);
    // Only one stocktake is open at a time.
    await pg.exec(`INSERT INTO "FacStocktake" ("id", "schoolId", "name", "createdById") VALUES ('k1', 's1', 'First', 'u1')`);
    await expect(pg.exec(`INSERT INTO "FacStocktake" ("id", "schoolId", "name", "createdById") VALUES ('k2', 's1', 'Second', 'u1')`)).rejects.toThrow(/FacStocktake_one_open/);
  });
});
