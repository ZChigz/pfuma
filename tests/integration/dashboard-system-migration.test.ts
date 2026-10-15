// @vitest-environment node
// The Dashboard & System migrations, applied on top of a school that already exists
// with users, students, a term and history, the way production applies them.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => (await pg.query<T>(sql, params)).rows[0];
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const count = async (table: string) => Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`)).n);

let before: Record<string, number>;

beforeAll(async () => {
  pg = await createPg('20261023000000_dashboard_system');
  await pg.exec(`
    INSERT INTO "School" ("id","name","location") VALUES ('s1','Old School A','Harare'),('s2','Old School B',NULL);
    INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES
      ('u1','s1','Admin One','a@s1.test','h','ADMIN'),('u2','s2','Admin Two','a@s2.test','h','ADMIN');
    INSERT INTO "AuditLog" ("id","schoolId","actorId","action","entityType","entityId") VALUES ('l1','s1','u1','CREATE_USER','User','u1');
  `);
  before = { School: await count('School'), User: await count('User'), AuditLog: await count('AuditLog') };
  await applyMigration(pg, '20261023000000_dashboard_system');
  await applyMigration(pg, '20261023000100_dashboard_system_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('Dashboard & System migrations', () => {
  it('lose no rows', async () => {
    expect(await count('School')).toBe(before.School);
    expect(await count('User')).toBe(before.User);
    expect(await count('AuditLog')).toBe(before.AuditLog);
  });

  it('give existing schools safe profile defaults and keep what they had', async () => {
    const rows = await all<Record<string, unknown>>(`SELECT "id","name","location","schoolType","defaultCurrency","phone","logoUrl" FROM "School" ORDER BY "id"`);
    expect(rows[0]).toMatchObject({ name: 'Old School A', location: 'Harare', schoolType: 'GOVERNMENT', defaultCurrency: 'USD', phone: null, logoUrl: null });
    expect(rows[1]).toMatchObject({ name: 'Old School B', schoolType: 'GOVERNMENT', defaultCurrency: 'USD' });
  });

  it('give every existing school one active subscription with no end date and no student limit', async () => {
    const rows = await all<Record<string, unknown>>(`SELECT "schoolId","plan","status","endsAt","studentLimit" FROM "Subscription" ORDER BY "schoolId"`);
    expect(rows).toEqual([
      { schoolId: 's1', plan: 'STANDARD', status: 'ACTIVE', endsAt: null, studentLimit: null },
      { schoolId: 's2', plan: 'STANDARD', status: 'ACTIVE', endsAt: null, studentLimit: null },
    ]);
  });

  it('leave every module on (no switch rows) and grant no extra permissions', async () => {
    expect(await count('SchoolModule')).toBe(0);
    expect(await count('RolePermission')).toBe(0);
  });

  it('can be run again without creating duplicates', async () => {
    await applyMigration(pg, '20261023000100_dashboard_system_backfill');
    expect(await count('Subscription')).toBe(2);
  });

  it('give a school added later no subscription row until one is created (the page copes)', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s3','New School')`);
    expect(await count('Subscription')).toBe(2);
    await applyMigration(pg, '20261023000100_dashboard_system_backfill');
    expect(await count('Subscription')).toBe(3);
  });

  it('keep one subscription per school and sensible values', async () => {
    await expect(pg.exec(`INSERT INTO "Subscription" ("id","schoolId","updatedAt") VALUES ('x','s1',CURRENT_TIMESTAMP)`)).rejects.toThrow();
    await expect(pg.exec(`INSERT INTO "Subscription" ("id","schoolId","studentLimit","updatedAt") VALUES ('x','s9',0,CURRENT_TIMESTAMP)`)).rejects.toThrow();
    await expect(pg.exec(`UPDATE "Subscription" SET "endsAt" = "startsAt" - interval '1 day' WHERE "schoolId" = 's1'`)).rejects.toThrow();
  });

  it('refuse to switch System off, and one switch per module per school', async () => {
    await expect(pg.exec(`INSERT INTO "SchoolModule" ("id","schoolId","module","enabled","updatedAt") VALUES ('m1','s1','system',false,CURRENT_TIMESTAMP)`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "SchoolModule" ("id","schoolId","module","enabled","updatedAt") VALUES ('m2','s1','finance',false,CURRENT_TIMESTAMP)`);
    await expect(pg.exec(`INSERT INTO "SchoolModule" ("id","schoolId","module","enabled","updatedAt") VALUES ('m3','s1','finance',true,CURRENT_TIMESTAMP)`)).rejects.toThrow();
  });

  it('refuse a calendar event that ends before it starts', async () => {
    await expect(pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","startDate","endDate","createdById") VALUES ('c1','s1','Bad','2026-05-02','2026-05-01','u1')`)).rejects.toThrow();
    await pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","startDate","endDate","createdById") VALUES ('c2','s1','Good','2026-05-01','2026-05-01','u1')`);
  });

  it('refuse rows that point into another school', async () => {
    await expect(pg.exec(`INSERT INTO "Notification" ("id","schoolId","userId","title") VALUES ('n1','s1','u2','Hi')`)).rejects.toThrow(/Cross-school reference/);
    await expect(pg.exec(`INSERT INTO "CalendarEvent" ("id","schoolId","title","startDate","endDate","createdById") VALUES ('c3','s1','X','2026-05-01','2026-05-01','u2')`)).rejects.toThrow(/Cross-school reference/);
    await pg.exec(`INSERT INTO "Notification" ("id","schoolId","userId","title") VALUES ('n2','s1','u1','Hi')`);
  });

  it('turn on forced row-level security on all five new tables', async () => {
    const rows = await all<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('Subscription','SchoolModule','RolePermission','Notification','CalendarEvent')`,
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity]).toEqual([r.relname, true, true]);
  });

  it('show only the active school’s rows once a school is set', async () => {
    await pg.exec(`CREATE ROLE app_user NOLOGIN; GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user; GRANT USAGE ON SCHEMA public TO app_user;`);
    const seen = await pg.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE app_user`);
      await tx.query(`SELECT set_config('app.school_id', 's2', true)`);
      return (await tx.query(`SELECT "id" FROM "CalendarEvent"`)).rows.length + (await tx.query(`SELECT "id" FROM "Subscription"`)).rows.length;
    });
    expect(seen).toBe(1); // s2 has its subscription, and none of s1's events
  });

  it('write row-level history for calendar events, module switches and role permissions', async () => {
    await pg.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.school_id', 's1', true), set_config('app.user_id', 'u1', true)`);
      await tx.query(`UPDATE "CalendarEvent" SET "title" = 'Renamed' WHERE "id" = 'c2'`);
      await tx.query(`INSERT INTO "RolePermission" ("id","schoolId","role","permission") VALUES ('r1','s1','HEAD','system.users.view')`);
    });
    const rows = await all<{ entityType: string; action: string }>(`SELECT "entityType","action" FROM "AuditLog" WHERE "action"::text LIKE 'DATA\\_%' ESCAPE '\\' ORDER BY "createdAt"`);
    expect(rows).toEqual(expect.arrayContaining([{ entityType: 'CalendarEvent', action: 'DATA_UPDATE' }, { entityType: 'RolePermission', action: 'DATA_CREATE' }]));
  });

  it('add the new audit actions', async () => {
    const { rows } = await pg.query<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditAction'`);
    const labels = rows.map((r) => r.enumlabel);
    for (const a of ['DEACTIVATE_USER', 'REACTIVATE_USER', 'UPDATE_SCHOOL_MODULES', 'CREATE_CALENDAR_EVENT', 'UPDATE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT']) expect(labels).toContain(a);
  });
});
