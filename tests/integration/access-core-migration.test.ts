// @vitest-environment node
// The access-control migrations (20261109*) applied on top of a school that already has roles, grants and people: nothing is lost,
// every old grant keeps working (SCHOOL scope), the catalogue's new columns are filled, and the database refuses the shapes the
// access rules forbid (overrides over 90 days, your own override, a decision on your own request, a decline without a reason ...).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const refuses = async (sql: string, params: unknown[] = []) => expect(pg.query(sql, params)).rejects.toThrow();

let ROLE: { owner: string; teacher: string; other: string };
let before: { grants: number; userRoles: number; permissions: number; roles: number };

beforeAll(async () => {
  pg = await createPg('20261109000000_access_enums');
  await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s1','School One'), ('s2','School Two');`);
  for (const [id, school] of [['owner', 's1'], ['head', 's1'], ['clerk', 's1'], ['teacher', 's1'], ['other', 's2']]) {
    await pg.query(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ($1,$2,$1,$3,'hash','TEACHER')`, [id, school, `${id}@x.test`]);
  }
  // Adding a school already creates its system roles (and the dashboard and calendar grants).
  const roleId = async (school: string, key: string) => (await all<{ id: string }>(`SELECT "id" FROM "RoleDefinition" WHERE "schoolId" = $1 AND "key" = $2`, [school, key]))[0].id;
  ROLE = { owner: await roleId("s1", "OWNER"), teacher: await roleId("s1", "TEACHER"), other: await roleId("s2", "TEACHER") };
  await pg.query(`INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey") VALUES ('g3','s1',$1,'students.medical.view')`, [ROLE.teacher]);

  const n = async (t: string) => Number((await all<{ c: string }>(`SELECT count(*)::int AS c FROM "${t}"`))[0].c);
  before = { grants: await n('RolePermission'), userRoles: await n('UserRole'), permissions: await n('Permission'), roles: await n('RoleDefinition') };

  await applyMigration(pg, '20261109000000_access_enums');
  await applyMigration(pg, '20261109000100_access_core');
  await applyMigration(pg, '20261109000200_access_core_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('nothing is lost', () => {
  it('keeps every role, grant, assignment and catalogue key', async () => {
    const n = async (t: string) => Number((await all<{ c: string }>(`SELECT count(*)::int AS c FROM "${t}"`))[0].c);
    expect({ grants: await n('RolePermission'), userRoles: await n('UserRole'), permissions: await n('Permission'), roles: await n('RoleDefinition') }).toEqual(before);
  });

  it('gives every existing grant SCHOOL scope, which is how the code treats it today', async () => {
    const rows = await all<{ scope: string }>(`SELECT DISTINCT "scope"::text AS scope FROM "RolePermission"`);
    expect(rows).toEqual([{ scope: 'SCHOOL' }]);
  });

  it('starts everyone at permVersion 0 and every school with the defaults', async () => {
    expect(await all(`SELECT DISTINCT "permVersion" FROM "User"`)).toEqual([{ permVersion: 0 }]);
    expect(await all(`SELECT "singlePersonFinance","deputyLeaveDelegation","previousTermReadDays" FROM "School" WHERE "id" = 's1'`)).toEqual([{ singlePersonFinance: false, deputyLeaveDelegation: false, previousTermReadDays: 30 }]);
    await refuses(`UPDATE "School" SET "previousTermReadDays" = 400 WHERE "id" = 's1'`);
  });

  it('adds the STORE scope for a role and the new audit actions', async () => {
    expect((await all<{ v: string }>(`SELECT unnest(enum_range(NULL::"RoleScopeType"))::text AS v`)).map((r) => r.v)).toContain('STORE');
    const actions = (await all<{ v: string }>(`SELECT unnest(enum_range(NULL::"AuditAction"))::text AS v`)).map((r) => r.v);
    for (const a of ['ACCESS_ROLE_ASSIGNED', 'ACCESS_OVERRIDE_SAVED', 'ACCESS_REQUEST_DECIDED', 'ACCESS_DENIED', 'PAY_VIEWED', 'EXPORT_DATA']) expect(actions).toContain(a);
  });
});

describe('the permission catalogue', () => {
  it('splits every key into page and action', async () => {
    expect(await all(`SELECT 1 FROM "Permission" WHERE "key" <> '*' AND ("page" = '' OR "action" = '')`)).toHaveLength(0);
    expect(await all(`SELECT "page","action" FROM "Permission" WHERE "key" = 'finance.payments.verify'`)).toEqual([{ page: 'payments', action: 'verify' }]);
    expect(await all(`SELECT "page","action" FROM "Permission" WHERE "key" = '*'`)).toEqual([{ page: '*', action: '*' }]);
  });

  it('marks the sensitive keys and no ordinary one', async () => {
    const sensitive = new Set((await all<{ key: string }>(`SELECT "key" FROM "Permission" WHERE "isSensitive"`)).map((r) => r.key));
    for (const k of ['students.medical.view', 'students.medical.edit', 'students.guardians.view_ids', 'students.discipline.view', 'hr.pay.view', 'hr.payroll.approve',
      'hr.discipline.view', 'finance.payments.void', 'finance.expenses.void', 'finance.refunds.approve', 'system.roles.edit', 'finance.reports.export', 'system.users.export']) {
      expect(sensitive.has(k), k).toBe(true);
    }
    for (const k of ['system.dashboard.view', 'finance.payments.record', 'exams.marks.enter', 'hr.leave.request']) expect(sensitive.has(k), k).toBe(false);
  });

  it('refuses a new key whose page or action does not match', async () => {
    await refuses(`INSERT INTO "Permission" ("key","module","page","action","description") VALUES ('system.thing.view','system','other','view','x')`);
    await pg.exec(`INSERT INTO "Permission" ("key","module","page","action","description") VALUES ('system.thing.view','system','thing','view','x')`);
  });

  it('can be run again without changing anything', async () => {
    const snapshot = JSON.stringify(await all(`SELECT "key","page","action","isSensitive" FROM "Permission" ORDER BY 1`));
    await pg.exec(`UPDATE "Permission" SET "page" = '' WHERE "key" = 'system.thing.view'`).catch(() => undefined);
    expect(JSON.stringify(await all(`SELECT "key","page","action","isSensitive" FROM "Permission" ORDER BY 1`))).toBe(snapshot);
  });
});

describe('roles', () => {
  it('remember what they were copied from, and keep that when the original goes', async () => {
    await pg.query(`INSERT INTO "RoleDefinition" ("id","schoolId","key","name","description","isSystem","copiedFromRoleId","updatedAt") VALUES ('r-copy','s1','CUSTOM_TEACHER','Custom','x',false,$1,now())`, [ROLE.teacher]);
    await refuses(`UPDATE "RoleDefinition" SET "copiedFromRoleId" = "id" WHERE "id" = 'r-copy'`);
    await pg.exec(`INSERT INTO "RoleDefinition" ("id","schoolId","key","name","description","isSystem","copiedFromRoleId","updatedAt") VALUES ('r-orig','s1','TMP_ORIG','Tmp','x',false,NULL,now()), ('r-copy2','s1','TMP_COPY','Tmp2','x',false,'r-orig',now())`);
    await pg.exec(`DELETE FROM "RoleDefinition" WHERE "id" = 'r-orig'`);
    expect(await all(`SELECT "copiedFromRoleId" FROM "RoleDefinition" WHERE "id" = 'r-copy2'`)).toEqual([{ copiedFromRoleId: null }]);
  });

  it('record who assigned them, and may be pinned to a store', async () => {
    await pg.query(`INSERT INTO "UserRole" ("id","schoolId","userId","roleId","scopeType","scopeId","assignedById","updatedAt") VALUES ('ur4','s1','clerk',$1,'STORE','store-1','owner',now())`, [ROLE.teacher]);
    expect(await all(`SELECT "assignedById" FROM "UserRole" WHERE "id" = 'ur4'`)).toEqual([{ assignedById: 'owner' }]);
  });
});

const override = (over: Record<string, string | null> = {}) => {
  const v = { id: 'o?', user: 'teacher', key: 'finance.reports.view', scope: 'SCHOOL', scopeId: '', effect: 'GRANT', reason: 'Covering for the bursar', days: '30', by: 'owner', ...over };
  return pg.query(
    `INSERT INTO "UserPermissionOverride" ("id","schoolId","userId","permissionKey","scope","scopeId","effect","reason","expiresAt","createdById","createdAt")
     VALUES ($1,'s1',$2,$3,$4::"AccessScope",$5,$6::"OverrideEffect",$7, now() + ($8 || ' days')::interval, $9, now())`,
    [v.id === 'o?' ? `o-${Math.random().toString(36).slice(2)}` : v.id, v.user, v.key, v.scope, v.scopeId, v.effect, v.reason, v.days, v.by],
  );
};

describe('overrides', () => {
  it('accept a grant or a deny for up to 90 days, with a reason', async () => {
    await override();
    await override({ effect: 'DENY', days: '89' });
    await override({ scope: 'DEPARTMENT', scopeId: 'dept-1', key: 'exams.marks.verify' });
  });

  it('refuse more than 90 days, no end, or a reason that is not given', async () => {
    await expect(override({ days: '91' })).rejects.toThrow();
    await expect(override({ days: '0' })).rejects.toThrow();
    await expect(override({ days: '-3' })).rejects.toThrow();
    await expect(override({ reason: '  ' })).rejects.toThrow();
  });

  it('refuse an override you make for yourself (rule 8)', async () => {
    await expect(override({ user: 'owner', by: 'owner' })).rejects.toThrow();
  });

  it('name which department, class, hostel or store a pinned scope means, and nothing for the others', async () => {
    await expect(override({ scope: 'CLASS', scopeId: '' })).rejects.toThrow();
    await expect(override({ scope: 'SCHOOL', scopeId: 'c1' })).rejects.toThrow();
    await expect(override({ scope: 'CHILDREN' })).rejects.toThrow();
  });

  it('refuse the wildcard and a key that is not in the catalogue', async () => {
    await expect(override({ key: '*' })).rejects.toThrow();
    await expect(override({ key: 'nope.nothing.view' })).rejects.toThrow();
  });
});

describe('access requests', () => {
  const request = (id: string, user = 'teacher', key = 'finance.reports.view') =>
    pg.query(`INSERT INTO "AccessRequest" ("id","schoolId","userId","permissionKey","page","reason") VALUES ($1,'s1',$2,$3,'/finance/reports','I need the term report')`, [id, user, key]);

  it('allow one open request per person per key', async () => {
    await request('ar1');
    await expect(request('ar2')).rejects.toThrow();
    await request('ar3', 'teacher', 'finance.dashboard.view');
  });

  it('keep the decision consistent: decided by someone else, at a time, with a reason for a decline', async () => {
    await refuses(`UPDATE "AccessRequest" SET "status" = 'APPROVED' WHERE "id" = 'ar1'`); // no decider
    await refuses(`UPDATE "AccessRequest" SET "status" = 'APPROVED', "decidedById" = 'teacher', "decidedAt" = now() WHERE "id" = 'ar1'`); // own request
    await refuses(`UPDATE "AccessRequest" SET "status" = 'DECLINED', "decidedById" = 'owner', "decidedAt" = now() WHERE "id" = 'ar1'`); // no reason
    await pg.exec(`UPDATE "AccessRequest" SET "status" = 'DECLINED', "decidedById" = 'owner', "decidedAt" = now(), "decisionNote" = 'Ask the bursar for the printout' WHERE "id" = 'ar1'`);
    await request('ar4'); // a declined request no longer blocks a new one
  });

  it('link an approval to the override it made, and only an approval', async () => {
    await override({ id: 'o-for-request' });
    await refuses(`UPDATE "AccessRequest" SET "resultingOverrideId" = 'o-for-request' WHERE "id" = 'ar4'`); // still pending
    await pg.exec(`UPDATE "AccessRequest" SET "status" = 'APPROVED', "decidedById" = 'owner', "decidedAt" = now(), "resultingOverrideId" = 'o-for-request' WHERE "id" = 'ar4'`);
    await refuses(`INSERT INTO "AccessRequest" ("id","schoolId","userId","permissionKey","page","reason","status","decidedById","decidedAt","resultingOverrideId")
                   VALUES ('ar5','s1','head','finance.reports.view','/x','reason here','APPROVED','owner',now(),'o-for-request')`); // one request per override
  });
});

describe('protection of the new tables', () => {
  it('have row-level security and the row-change audit trigger, like the other school tables', async () => {
    for (const t of ['UserPermissionOverride', 'AccessRequest']) {
      expect(await all(`SELECT 1 FROM pg_class WHERE relname = $1 AND relrowsecurity AND relforcerowsecurity`, [t]), t).toHaveLength(1);
      expect(await all(`SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = 'school_isolation'`, [t]), t).toHaveLength(1);
      expect(await all(`SELECT 1 FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`, [`"${t}"`, `audit_${t}`]), t).toHaveLength(1);
    }
  });
});
