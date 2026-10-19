// @vitest-environment node
// The settings-structure migrations applied on top of schools that already have classes,
// grade boundaries, receipt prefixes and admission numbers.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await pg.query<T>(sql)).rows;
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await all<T>(sql))[0];

beforeAll(async () => {
  pg = await createPg('20261028000000_settings_structure');
  await pg.exec(`
    INSERT INTO "School" ("id","name","receiptPrefix") VALUES ('s1','Old School A','RCT'),('s2','Old School B',NULL),('s3','Odd Prefix School','not a prefix!');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('u1','s1','Admin','a@s1.test','h','ADMIN');
    INSERT INTO "Level" ("id","schoolId","name","order","category") VALUES ('l1','s1','Form 1',1,'O_LEVEL'),('l2','s1','Form 5',5,'A_LEVEL'),('l3','s2','Form 1',1,'O_LEVEL');
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream") VALUES
      ('c1','s1','Form 1 North','l1','North'),
      ('c2','s1','Form 5 north','l2','north'),
      ('c3','s1','Form 1 South','l1','  South '),
      ('c4','s1','Form 1','l1',''),
      ('c5','s2','Form 1 Red','l3','Red');
    INSERT INTO "GradeBoundary" ("id","schoolId","minPercent","maxPercent","letterGrade") VALUES ('g1','s1',0,49,'F'),('g2','s1',50,100,'P');
    INSERT INTO "Student" ("id","schoolId","admissionNumber","firstName","surname","fullName","admissionDate") VALUES ('st1','s1','STU20260007','A','B','A B','2026-01-10');
  `);
  await applyMigration(pg, '20261028000000_settings_structure');
  await applyMigration(pg, '20261028000100_settings_structure_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('settings-structure migrations', () => {
  it('lose nothing', async () => {
    expect((await all(`SELECT 1 FROM "SchoolClass"`)).length).toBe(5);
    expect((await all(`SELECT 1 FROM "GradeBoundary"`)).length).toBe(2);
    expect((await one<{ admissionNumber: string }>(`SELECT "admissionNumber" FROM "Student"`)).admissionNumber).toBe('STU20260007');
  });

  it('start with every form on', async () => {
    expect((await all<{ active: boolean }>(`SELECT "active" FROM "Level"`)).every((l) => l.active)).toBe(true);
  });

  it('fill the stream list from the streams classes already use, one spelling each, none blank', async () => {
    const rows = await all<{ schoolId: string; name: string }>(`SELECT "schoolId","name" FROM "Stream" ORDER BY "schoolId","name"`);
    expect(rows).toEqual([
      { schoolId: 's1', name: 'North' },   // "North" and "north" are one stream; the earlier spelling is kept
      { schoolId: 's1', name: 'South' },   // trimmed
      { schoolId: 's2', name: 'Red' },
    ]);
  });

  it('turn a receipt prefix into a receipt format, and leave schools without one empty', async () => {
    const rows = await all<{ id: string; receiptFormat: string | null; receiptPrefix: string | null }>(`SELECT "id","receiptFormat","receiptPrefix" FROM "School" ORDER BY "id"`);
    expect(rows).toEqual([
      { id: 's1', receiptFormat: 'RCT-{000000}', receiptPrefix: 'RCT' },
      { id: 's2', receiptFormat: null, receiptPrefix: null },
      { id: 's3', receiptFormat: null, receiptPrefix: 'not a prefix!' }, // not a usable prefix: left for the school to choose
    ]);
  });

  it('keep admission numbers exactly as they were, and both currencies on', async () => {
    for (const r of await all<Record<string, unknown>>(`SELECT "schoolCode","admissionFormat","currencyUsdEnabled","currencyZigEnabled","invoiceNextNumber","defaultCurrency"::text AS cur FROM "School"`)) {
      expect(r).toEqual({ schoolCode: 'STU', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}', currencyUsdEnabled: true, currencyZigEnabled: true, invoiceNextNumber: 1, cur: 'USD' });
    }
  });

  it('leave grade boundaries as the older school-wide set (no category), so grading is unchanged', async () => {
    for (const r of await all<{ category: unknown; points: unknown; remark: unknown }>(`SELECT "category","points","remark" FROM "GradeBoundary"`)) {
      expect(r).toEqual({ category: null, points: null, remark: null });
    }
  });

  it('can be run again without making duplicates', async () => {
    await applyMigration(pg, '20261028000100_settings_structure_backfill');
    expect((await all(`SELECT 1 FROM "Stream"`)).length).toBe(3);
  });

  it('keeps one stream per name in a school, ignoring capitals, and lets two schools share a name', async () => {
    await expect(pg.exec(`INSERT INTO "Stream" ("id","schoolId","name") VALUES ('x1','s1','NORTH')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "Stream" ("id","schoolId","name") VALUES ('x2','s1','   ')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "Stream" ("id","schoolId","name") VALUES ('x3','s1','${'x'.repeat(31)}')`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "Stream" ("id","schoolId","name") VALUES ('x4','s2','North')`);
  });

  it('refuses a category scale that belongs to a level or term, and negative points', async () => {
    await expect(pg.exec(`INSERT INTO "GradeBoundary" ("id","schoolId","levelId","category","minPercent","maxPercent","letterGrade") VALUES ('b1','s1','l1','O_LEVEL',0,100,'X')`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "GradeBoundary" ("id","schoolId","category","points","minPercent","maxPercent","letterGrade") VALUES ('b2','s1','O_LEVEL',-1,0,100,'X')`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "GradeBoundary" ("id","schoolId","category","points","remark","minPercent","maxPercent","letterGrade") VALUES ('b3','s1','A_LEVEL',5,'Excellent',80,100,'A')`);
  });

  it('refuses impossible currency and number-format settings', async () => {
    const bad = (set: string) => pg.exec(`UPDATE "School" SET ${set} WHERE "id" = 's2'`);
    await expect(bad(`"currencyUsdEnabled" = false, "currencyZigEnabled" = false`)).rejects.toThrow();
    await expect(bad(`"currencyZigEnabled" = false, "defaultCurrency" = 'ZIG'`)).rejects.toThrow();
    await expect(bad(`"admissionFormat" = 'ADM'`)).rejects.toThrow();
    await expect(bad(`"schoolCode" = 'bad code'`)).rejects.toThrow();
    await expect(bad(`"invoiceNextNumber" = 0`)).rejects.toThrow();
    await bad(`"currencyZigEnabled" = false, "defaultCurrency" = 'USD', "schoolCode" = 'CHS', "admissionFormat" = '{SCHOOLCODE}{YY}{000}'`);
  });

  it('turn on row-level security for streams, keeping schools apart', async () => {
    await pg.exec(`CREATE ROLE app_user NOLOGIN; GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user; GRANT USAGE ON SCHEMA public TO app_user;`);
    const seen = await pg.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE app_user`);
      await tx.query(`SELECT set_config('app.school_id', 's2', true)`);
      return (await tx.query<{ name: string }>(`SELECT "name" FROM "Stream"`)).rows.map((r) => r.name);
    });
    expect(seen.sort()).toEqual(['North', 'Red']);
  });

  it('add the new audit actions', async () => {
    const labels = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditAction'`)).map((r) => r.enumlabel);
    for (const a of ['UPDATE_FORMS', 'UPDATE_STREAMS', 'ARCHIVE_CLASS', 'DELETE_CLASS', 'UPDATE_GRADING', 'UPDATE_FINANCE_SETTINGS', 'UPDATE_NUMBERING']) expect(labels).toContain(a);
  });
});
