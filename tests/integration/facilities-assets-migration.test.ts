// The assets data step: the first asset register (categories, assets, transfers, maintenance, disposals) is copied into the Facilities
// register without losing anything, a second run changes nothing, and the rules of the new register hold for the copied rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const q = async (sql: string) => (await pg.query(sql)).rows as Record<string, unknown>[];
const BACKFILL = '20261110000100_facilities_assets_backfill';

beforeAll(async () => {
  pg = await createPg(BACKFILL);
  await pg.exec(`INSERT INTO "School" ("id", "name") VALUES ('s1', 'Alpha'), ('s2', 'Beta')`);
  await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role") VALUES ('u1', 's1', 'Mrs Teacher', 'u1@x.test', 'x', 'TEACHER'), ('u2', 's1', 'Bursar', 'u2@x.test', 'x', 'BURSAR'), ('u3', 's2', 'Other', 'u3@x.test', 'x', 'BURSAR')`);
  await pg.exec(`INSERT INTO "Employee" ("id", "schoolId", "employeeNo", "userId", "firstName", "surname", "jobTitle", "startDate", "createdById", "updatedAt") VALUES ('e1', 's1', 'EMP-1', 'u1', 'Mrs', 'Teacher', 'Teacher', '2020-01-01', 'u1', now())`);
  await pg.exec(`INSERT INTO "AssetCategory" ("id", "schoolId", "name") VALUES ('c1', 's1', 'ICT'), ('c2', 's1', 'Furniture'), ('c3', 's1', 'Boats'), ('c4', 's2', 'ICT')`);
  await pg.exec(`INSERT INTO "Asset" ("id", "schoolId", "name", "categoryId", "tagNumber", "acquisitionDate", "acquisitionCost", "currency", "location", "custodianId", "custodian", "condition", "status", "description", "imageUrl") VALUES
    ('a1', 's1', 'Projector', 'c1', 'AST-00412', '2025-02-01', 900.50, 'USD', 'Staffroom', 'u1', NULL, 'EXCELLENT', 'ACTIVE', 'Epson', NULL),
    ('a2', 's1', 'Desk', 'c2', 'DSK-1', '2020-01-01', 30, 'USD', 'Form 1', NULL, 'Mr Moyo', 'CONDEMNED', 'UNDER_MAINTENANCE', NULL, 'https://x.test/p.png'),
    ('a3', 's1', 'Old boat', 'c3', 'BT-1', '2015-01-01', 1000, 'ZIG', 'Dam', NULL, NULL, 'POOR', 'DISPOSED', NULL, NULL),
    ('a4', 's1', 'Ghost', 'c1', 'GH-1', '2015-01-01', 10, 'USD', 'Nowhere', NULL, NULL, 'FAIR', 'DISPOSED', NULL, NULL),
    ('a5', 's2', 'Laptop', 'c4', 'AST-00001', '2026-01-01', 400, 'USD', 'Lab', NULL, NULL, 'GOOD', 'ACTIVE', NULL, NULL)`);
  await pg.exec(`INSERT INTO "AssetTransfer" ("id", "schoolId", "assetId", "fromLocation", "toLocation", "fromCustodianId", "toCustodianId", "transferDate", "recordedById") VALUES
    ('t1', 's1', 'a1', 'Office', 'Staffroom', NULL, 'u1', '2025-03-01', 'u2'), ('t2', 's1', 'a1', 'Staffroom', 'Staffroom', NULL, NULL, '2025-04-01', 'u2')`);
  await pg.exec(`INSERT INTO "AssetMaintenance" ("id", "schoolId", "assetId", "maintenanceDate", "description", "cost", "currency", "provider", "nextServiceDate", "recordedBy") VALUES
    ('m1', 's1', 'a1', '2026-01-10', 'Lamp replaced', 25.5, 'USD', 'Tech Fix', '2026-07-10', 'u2'), ('m2', 's1', 'a2', '2026-02-01', 'Ok', NULL, NULL, NULL, NULL, 'u2')`);
  await pg.exec(`INSERT INTO "AssetDisposal" ("id", "schoolId", "assetId", "disposalDate", "reason", "method", "proceeds", "currency", "recordedBy") VALUES ('d1', 's1', 'a3', '2026-03-01', 'Sank', 'SCRAPPED', NULL, NULL, 'u2')`);
});
afterAll(async () => { await pg?.close(); });

describe('assets data step', () => {
  it('copies the categories with their usual lives', async () => {
    await applyMigration(pg, BACKFILL);
    const c = await q(`SELECT "schoolId", "name", "depreciationYears" FROM "FacAssetCategory" ORDER BY "schoolId", "name"`);
    expect(c).toEqual([
      { schoolId: 's1', name: 'Boats', depreciationYears: null }, { schoolId: 's1', name: 'Furniture', depreciationYears: 10 }, { schoolId: 's1', name: 'ICT', depreciationYears: 3 },
      { schoolId: 's2', name: 'ICT', depreciationYears: 3 },
    ]);
  });

  it('keeps each asset\'s tag, cost in cents, place, condition and status, and the custodian\'s staff record', async () => {
    const a = await q(`SELECT a."tag", a."name", a."costCents", a."currency", a."location", a."condition", a."status", a."custodianId", a."notes", c."name" AS category FROM "FacAsset" a JOIN "FacAssetCategory" c ON c."id" = a."categoryId" ORDER BY a."legacyAssetId"`);
    expect(a).toEqual([
      { tag: 'AST-00412', name: 'Projector', costCents: 90_050, currency: 'USD', location: 'Staffroom', condition: 'NEW', status: 'IN_USE', custodianId: 'e1', notes: 'Epson', category: 'ICT' },
      { tag: 'DSK-1', name: 'Desk', costCents: 3000, currency: 'USD', location: 'Form 1', condition: 'POOR', status: 'UNDER_REPAIR', custodianId: null, notes: 'Custodian: Mr Moyo. Photo: https://x.test/p.png', category: 'Furniture' },
      { tag: 'BT-1', name: 'Old boat', costCents: 100_000, currency: 'ZIG', location: 'Dam', condition: 'POOR', status: 'DISPOSED', custodianId: null, notes: null, category: 'Boats' },
      { tag: 'GH-1', name: 'Ghost', costCents: 1000, currency: 'USD', location: 'Nowhere', condition: 'FAIR', status: 'IN_STORAGE', custodianId: null, notes: null, category: 'ICT' },
      { tag: 'AST-00001', name: 'Laptop', costCents: 40_000, currency: 'USD', location: 'Lab', condition: 'GOOD', status: 'IN_USE', custodianId: null, notes: null, category: 'ICT' },
    ]);
  });

  it('carries the tag counter on, and copies transfers, maintenance and disposals', async () => {
    expect(await q(`SELECT "schoolId", "nextNumber" FROM "FacSequence" WHERE "key" = 'AST' ORDER BY "schoolId"`)).toEqual([{ schoolId: 's1', nextNumber: 413 }, { schoolId: 's2', nextNumber: 2 }]);
    // A "transfer" that moved nothing is not copied.
    expect(await q(`SELECT "fromLocation", "toLocation", "toCustodianId", "confirmedAt" IS NOT NULL AS confirmed FROM "FacAssetTransfer"`)).toEqual([{ fromLocation: 'Office', toLocation: 'Staffroom', toCustodianId: 'e1', confirmed: true }]);
    const jobs = await q(`SELECT "problem", "status", "workDone", "provider", "costCents", "currency" FROM "FacMaintenanceJob" ORDER BY "problem"`);
    expect([...jobs].sort((a, b) => String(a.problem).localeCompare(String(b.problem)))).toEqual([
      { problem: 'Lamp replaced', status: 'DONE', workDone: 'Lamp replaced', provider: 'Tech Fix', costCents: 2550, currency: 'USD' },
      { problem: 'Ok', status: 'DONE', workDone: 'Ok (maintenance)', provider: null, costCents: null, currency: null },
    ]);
    expect(await q(`SELECT "method", "reason", "headApprovedById", "ownerApprovedById" FROM "FacAssetDisposal"`)).toEqual([{ method: 'SCRAPPED', reason: 'Sank', headApprovedById: 'u2', ownerApprovedById: null }]);
  });

  it('running it again changes nothing', async () => {
    const count = async () => (await q(`SELECT (SELECT count(*) FROM "FacAsset")::int AS a, (SELECT count(*) FROM "FacAssetCategory")::int AS c, (SELECT count(*) FROM "FacAssetTransfer")::int AS t, (SELECT count(*) FROM "FacMaintenanceJob")::int AS m, (SELECT count(*) FROM "FacAssetDisposal")::int AS d`))[0];
    const before = await count();
    await pg.exec(fs.readFileSync(path.resolve(__dirname, `../../prisma/migrations/${BACKFILL}/migration.sql`), 'utf8'));
    expect(await count()).toEqual(before);
    expect(before).toEqual({ a: 5, c: 4, t: 1, m: 2, d: 1 });
  });

  it('the rules of the new register hold for the copied rows', async () => {
    // The old disposal is the only one; a second is refused. A disposed asset cannot be changed. A new disposal above the limit needs the Owner.
    await expect(pg.exec(`INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "ownerApprovedById", "recordedById") SELECT 'x', 's1', "id", 'SOLD', 'Again', now(), 'u2', 'u1', 'u2' FROM "FacAsset" WHERE "tag" = 'BT-1'`)).rejects.toThrow(/duplicate|unique/i);
    await expect(pg.exec(`UPDATE "FacAsset" SET "location" = 'Elsewhere' WHERE "tag" = 'BT-1'`)).rejects.toThrow(/disposed asset cannot be changed/);
    await expect(pg.exec(`INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "headApprovedById", "recordedById") SELECT 'y', 's1', "id", 'SCRAPPED', 'Quietly', now(), 'u2', 'u1' FROM "FacAsset" WHERE "tag" = 'AST-00412'`)).rejects.toThrow(/Owner must approve/);
  });
});
