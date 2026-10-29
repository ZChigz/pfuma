// @vitest-environment node
// The stream-level migrations applied on top of schools that already have streams and classes.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await pg.query<T>(sql)).rows;

beforeAll(async () => {
  pg = await createPg('20261117000000_stream_level_category');
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School A'),('s2','Old School B');
    INSERT INTO "Level" ("id","schoolId","name","order","category") VALUES
      ('l1','s1','Form 1',1,'O_LEVEL'),('l5','s1','Form 5',5,'A_LEVEL'),('l6','s1','Form 6',6,'A_LEVEL'),('m5','s2','Form 5',5,'A_LEVEL');
    INSERT INTO "Stream" ("id","schoolId","name") VALUES
      ('st1','s1','North'),('st2','s1','Sciences'),('st3','s1','Blue'),('st4','s1','Arts'),('st5','s2','North');
    INSERT INTO "SchoolClass" ("id","schoolId","name","levelId","stream") VALUES
      ('c1','s1','Form 1 North','l1','North'),
      ('c2','s1','Form 5 Sciences','l5','sciences '),
      ('c3','s1','Form 6 Sciences','l6','Sciences'),
      ('c4','s1','Form 1 Blue','l1','Blue'),
      ('c5','s1','Form 5 Blue','l5','Blue'),
      ('c6','s2','Form 5 North','m5','North');
  `);
  await applyMigration(pg, '20261117000000_stream_level_category');
  await applyMigration(pg, '20261117000100_stream_level_category_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('stream-level migrations', () => {
  it('lose nothing', async () => {
    expect((await all(`SELECT 1 FROM "Stream"`)).length).toBe(5);
    expect((await all(`SELECT 1 FROM "SchoolClass"`)).length).toBe(6);
  });

  it('make a stream A Level only when Form 5 and 6 classes alone use it', async () => {
    const rows = await all<{ id: string; category: string }>(`SELECT "id","category" FROM "Stream" ORDER BY "id"`);
    expect(rows).toEqual([
      { id: 'st1', category: 'O_LEVEL' }, // North: Form 1 only
      { id: 'st2', category: 'A_LEVEL' }, // Sciences: Form 5 and 6 only, matched ignoring case and spaces
      { id: 'st3', category: 'O_LEVEL' }, // Blue: used by both, stays O Level
      { id: 'st4', category: 'O_LEVEL' }, // Arts: unused, stays O Level
      { id: 'st5', category: 'A_LEVEL' }, // another school, judged on its own classes
    ]);
  });

  it('give new streams O Level unless told otherwise', async () => {
    await pg.exec(`INSERT INTO "Stream" ("id","schoolId","name") VALUES ('st6','s1','East')`);
    expect((await all<{ category: string }>(`SELECT "category" FROM "Stream" WHERE "id" = 'st6'`))[0].category).toBe('O_LEVEL');
  });
});
