// @vitest-environment node
// The calendar migration applied on top of events that already exist.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await pg.query<T>(sql)).rows;

beforeAll(async () => {
  pg = await createPg('20261026000000_calendar_v2');
  await pg.exec(`
    INSERT INTO "School" ("id","name") VALUES ('s1','Old School');
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('u1','s1','Admin','a@s1.test','h','ADMIN');
    INSERT INTO "CalendarEvent" ("id","schoolId","title","kind","startDate","endDate","notes","createdById") VALUES
      ('e1','s1','Heroes Day','HOLIDAY','2026-08-10','2026-08-11','No school','u1'),
      ('e2','s1','Mock exams','EXAM','2026-09-01','2026-09-04',NULL,'u1'),
      ('e3','s1','Sports day','SPORTS','2026-06-10','2026-06-10','Bring water','u1'),
      ('e4','s1','Staff meeting','MEETING','2026-05-04','2026-05-04',NULL,'u1'),
      ('e5','s1','Open day','OTHER','2026-07-01','2026-07-01',NULL,'u1');
  `);
  await applyMigration(pg, '20261026000000_calendar_v2');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('calendar migration', () => {
  it('loses no events and keeps their dates and descriptions', async () => {
    const rows = await all<{ id: string; title: string; startDate: Date; endDate: Date; notes: string | null }>(`SELECT "id","title","startDate","endDate","notes" FROM "CalendarEvent" ORDER BY "id"`);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ title: 'Heroes Day', notes: 'No school' });
    expect(rows[0].startDate.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(rows[0].endDate.toISOString().slice(0, 10)).toBe('2026-08-11');
    expect(rows[2].notes).toBe('Bring water');
  });

  it('turns the old Holiday type into Public holiday and leaves the others alone', async () => {
    const kinds = await all<{ id: string; kind: string }>(`SELECT "id","kind"::text AS kind FROM "CalendarEvent" ORDER BY "id"`);
    expect(kinds.map((k) => k.kind)).toEqual(['PUBLIC_HOLIDAY', 'EXAM', 'SPORTS', 'MEETING', 'OTHER']);
  });

  it('gives existing events safe defaults: all day, no times, no repeat, all staff, not preloaded', async () => {
    const rows = await all<Record<string, unknown>>(`SELECT "allDay","startTime","endTime","location","repeat"::text AS repeat,"repeatUntil","audience"::text AS audience,"audienceLevelIds","audienceClassIds","autoKey" FROM "CalendarEvent"`);
    for (const r of rows) {
      expect(r).toEqual({ allDay: true, startTime: null, endTime: null, location: null, repeat: 'NONE', repeatUntil: null, audience: 'ALL_STAFF', audienceLevelIds: [], audienceClassIds: [], autoKey: null });
    }
  });

  it('adds the new types', async () => {
    const labels = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'CalendarEventKind'`)).map((r) => r.enumlabel);
    for (const k of ['PUBLIC_HOLIDAY', 'EXAM', 'MEETING', 'SPORTS', 'CULTURAL', 'VISITING_DAY', 'PRIZE_GIVING', 'OTHER']) expect(labels).toContain(k);
    expect(labels).not.toContain('HOLIDAY');
    await pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","kind","startDate","endDate","createdById") VALUES ('n1','s1','Prize giving','PRIZE_GIVING','2026-11-20','2026-11-20','u1')`);
  });

  it('enforces the rules in the database', async () => {
    const ins = (cols: string, vals: string) => pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","startDate","endDate","createdById",${cols}) VALUES ('x${Math.random()}','s1','T','2026-03-01','2026-03-01','u1',${vals})`);
    await expect(ins(`"allDay"`, `false`)).rejects.toThrow();
    await expect(ins(`"allDay","startTime","endTime"`, `false,'10:00','09:00'`)).rejects.toThrow();
    await expect(ins(`"startTime"`, `'25:99'`)).rejects.toThrow();
    await expect(ins(`"repeat"`, `'WEEKLY'`)).rejects.toThrow();
    await expect(ins(`"repeat","repeatUntil"`, `'WEEKLY','2026-02-01'`)).rejects.toThrow();
    await expect(ins(`"audience"`, `'FORMS'`)).rejects.toThrow();
    await expect(ins(`"audience","audienceClassIds"`, `'ALL_STAFF',ARRAY['c1']`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","startDate","endDate","createdById") VALUES ('long','s1','${'x'.repeat(121)}','2026-03-01','2026-03-01','u1')`)).rejects.toThrow();
    await ins(`"allDay","startTime","endTime","repeat","repeatUntil","audience","audienceLevelIds"`, `false,'08:00','09:30','WEEKLY','2026-04-01','FORMS',ARRAY['l1']`);
  });

  it('allows one preloaded holiday per key and school, and many ordinary events', async () => {
    const hol = (id: string, key: string) => pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","kind","startDate","endDate","createdById","autoKey") VALUES ('${id}','s1','H','PUBLIC_HOLIDAY','2026-01-01','2026-01-01','u1','${key}')`);
    await hol('h1', 'NEW_YEARS_DAY:2026');
    await expect(hol('h2', 'NEW_YEARS_DAY:2026')).rejects.toThrow();
    await hol('h3', 'NEW_YEARS_DAY:2027');
  });

  it('records which years have had their holidays loaded, once, and keeps schools apart', async () => {
    await pg.exec(`INSERT INTO "CalendarHolidayYear" ("id","schoolId","year") VALUES ('y1','s1',2026)`);
    await expect(pg.exec(`INSERT INTO "CalendarHolidayYear" ("id","schoolId","year") VALUES ('y2','s1',2026)`)).rejects.toThrow();
    const rls = await all<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CalendarHolidayYear'`);
    expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
