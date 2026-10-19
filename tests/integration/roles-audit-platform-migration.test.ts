// @vitest-environment node
// The roles / audit / platform migrations applied on top of a school that already has staff, grants,
// a subscription, audit entries and notifications: nobody loses access, nothing is lost.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;

const STAFF: Record<string, { role: string; staffRoles: string[] }> = {
  admin: { role: 'ADMIN', staffRoles: ['SCHOOL_ADMINISTRATOR'] },
  owner: { role: 'DIRECTOR', staffRoles: ['OWNER'] },
  head: { role: 'HEAD', staffRoles: ['HEAD_TEACHER', 'DEPUTY_HEAD'] },
  bursar: { role: 'BURSAR', staffRoles: ['BURSAR', 'ACCOUNTS_CLERK'] },
  teacher: { role: 'TEACHER', staffRoles: ['TEACHER', 'CLASS_TEACHER', 'HEAD_OF_DEPARTMENT'] },
  clerk: { role: 'TEACHER', staffRoles: ['REGISTRAR', 'OFFICE_SECRETARY', 'SENIOR_TEACHER'] },
  librarian: { role: 'LIBRARIAN', staffRoles: ['LIBRARIAN'] },
};

beforeAll(async () => {
  pg = await createPg('20261030000000_roles_audit_platform');
  await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s1','Old School'), ('s2','Trial School'), ('s3','Lapsed School'), ('s4','Cancelled School'), ('s5','No Subscription');`);
  for (const [k, v] of Object.entries(STAFF)) {
    await pg.query(
      `INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role","staffRoles") VALUES ($1,'s1',$2,$3,'hash',$4::"Role",$5::"StaffRole"[])`,
      [`u-${k}`, `Old ${k}`, `${k}@old.test`, v.role, `{${v.staffRoles.join(',')}}`],
    );
  }
  await pg.exec(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('u-s2','s2','S2 Head','head@s2.test','hash','HEAD')`);

  // Grants as the earlier build stored them (a role and a permission key per row).
  await pg.exec(`
    INSERT INTO "RolePermission" ("id","schoolId","role","permission") VALUES
      ('g1','s1','HEAD','system.users.view'), ('g2','s1','HEAD','system.users.update'), ('g3','s1','BURSAR','system.settings.update'),
      ('g4','s1','BURSAR','system.setup.view'), ('g5','s1','LIBRARIAN','system.users.invite'), ('g6','s1','TEACHER','finance.payments.view'),
      ('g7','s2','HEAD','system.audit.view');`);

  await pg.exec(`
    INSERT INTO "Subscription" ("id","schoolId","status","startsAt","endsAt","studentLimit","updatedAt") VALUES
      ('sub1','s1','ACTIVE','2025-01-01', NULL, 800, now()), ('sub2','s2','TRIAL','2025-01-01','2026-12-01', 300, now()),
      ('sub3','s3','EXPIRED','2025-01-01','2026-01-31', NULL, now()), ('sub4','s4','CANCELLED','2025-01-01', NULL, NULL, now());`);

  await pg.exec(`
    INSERT INTO "AuditLog" ("id","schoolId","actorId","action","entityType","entityId","detail") VALUES
      ('a1','s1','u-admin','RECORD_PAYMENT','Payment','p1','Receipt 1'), ('a2','s1','u-admin','CREATE_USER','User','u-head','Head'),
      ('a3','s1','u-admin','CREATE_STUDENT','Student','st1','A student'), ('a4','s1','u-admin','DATA_UPDATE','Whatever','w1',NULL);
    INSERT INTO "Notification" ("id","schoolId","userId","title","href") VALUES ('n1','s1','u-admin','Old note','/system/users'), ('n2','s1','u-head','No link', NULL);`);

  await applyMigration(pg, '20261030000000_roles_audit_platform');
  await applyMigration(pg, '20261030000100_roles_audit_platform_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

const rolesOf = async (userId: string) => (await all<{ key: string }>(`SELECT rd."key" FROM "UserRole" ur JOIN "RoleDefinition" rd ON rd."id" = ur."roleId" WHERE ur."userId" = $1 ORDER BY rd."key"`, [userId])).map((r) => r.key);
const grantsOf = async (schoolId: string, key: string) => (await all<{ k: string }>(`SELECT rp."permissionKey" AS k FROM "RolePermission" rp JOIN "RoleDefinition" rd ON rd."id" = rp."roleId" WHERE rd."schoolId" = $1 AND rd."key" = $2 ORDER BY 1`, [schoolId, key])).map((r) => r.k);

describe('roles and grants', () => {
  it('creates the 13 system roles for every school that already existed', async () => {
    for (const s of ['s1', 's2', 's3', 's4', 's5']) {
      const roles = await all<{ key: string; isSystem: boolean; name: string; description: string }>(`SELECT "key","isSystem","name","description" FROM "RoleDefinition" WHERE "schoolId" = $1`, [s]);
      expect(roles, s).toHaveLength(13);
      expect(roles.every((r) => r.isSystem && r.name && r.description)).toBe(true);
    }
  });

  it('gives every role the dashboard and calendar, Owner and Administrator everything, and nothing else beyond what was granted before', async () => {
    expect(await grantsOf('s5', 'TEACHER')).toEqual(['system.calendar.view', 'system.dashboard.view']);
    expect(await grantsOf('s5', 'OWNER')).toEqual(['*', 'system.calendar.view', 'system.dashboard.view']);
    expect(await grantsOf('s5', 'ADMINISTRATOR')).toEqual(['*', 'system.calendar.view', 'system.dashboard.view']);
  });

  it('keeps what a role was granted before, under the new key names', async () => {
    expect(await grantsOf('s1', 'HEAD')).toEqual(['system.calendar.view', 'system.dashboard.view', 'system.users.edit', 'system.users.view']);
    expect(await grantsOf('s1', 'BURSAR')).toEqual(['system.calendar.view', 'system.dashboard.view', 'system.settings.edit']); // setup.view became dashboard.view
    expect(await grantsOf('s1', 'LIBRARIAN')).toEqual(['system.calendar.view', 'system.dashboard.view', 'system.users.create']);
    expect(await grantsOf('s2', 'HEAD')).toEqual(['system.audit.view', 'system.calendar.view', 'system.dashboard.view']);
    expect(await grantsOf('s1', 'TEACHER')).toEqual(['system.calendar.view', 'system.dashboard.view']); // finance.* is not a System key: it was never a grant row that applied
  });

  it('keeps the old grants table, unread, and copies the system.* ones that apply under their new key (several old keys became settings.edit)', async () => {
    expect((await all('SELECT 1 FROM "RolePermissionOld"'))).toHaveLength(7);
    await pg.exec("INSERT INTO \"RolePermissionOld\" (\"id\",\"schoolId\",\"role\",\"permission\") VALUES ('g8','s5','HEAD','system.grading.update'), ('g9','s5','HEAD','system.academic.open'), ('g10','s5','HEAD','system.subscription.manage')");
    await applyMigration(pg, '20261030000100_roles_audit_platform_backfill');
    expect(await grantsOf('s5', 'HEAD')).toEqual(['system.calendar.view', 'system.dashboard.view', 'system.settings.edit', 'system.subscription.view']);
  });
});

describe('people', () => {
  it('lose nobody, and keep their access level', async () => {
    const users = await all<{ id: string; role: string }>(`SELECT "id","role"::text AS role FROM "User" WHERE "schoolId" = 's1' ORDER BY "id"`);
    expect(users).toHaveLength(7);
    expect(Object.fromEntries(users.map((u) => [u.id, u.role]))).toEqual({
      'u-admin': 'ADMIN', 'u-owner': 'DIRECTOR', 'u-head': 'HEAD', 'u-bursar': 'BURSAR', 'u-teacher': 'TEACHER', 'u-clerk': 'TEACHER', 'u-librarian': 'LIBRARIAN',
    });
  });

  it('turns the staff roles they were given into roles, mapping the older names onto the 13', async () => {
    expect(await rolesOf('u-admin')).toEqual(['ADMINISTRATOR']);
    expect(await rolesOf('u-owner')).toEqual(['OWNER']);
    expect(await rolesOf('u-head')).toEqual(['DEPUTY_HEAD', 'HEAD']);
    expect(await rolesOf('u-bursar')).toEqual(['ACCOUNTS_CLERK', 'BURSAR']);
    expect(await rolesOf('u-teacher')).toEqual(['CLASS_TEACHER', 'HOD', 'TEACHER']);
    expect(await rolesOf('u-clerk')).toEqual(['TEACHER']); // registrar, secretary and senior teacher are all teachers now
    expect(await rolesOf('u-librarian')).toEqual(['LIBRARIAN']);
  });

  it('gives anyone without staff roles the role that matches their access level', async () => {
    expect(await rolesOf('u-s2')).toEqual(['HEAD']);
  });

  it('start every role for the whole school', async () => {
    expect(await all(`SELECT DISTINCT "scopeType"::text AS s, "scopeId" FROM "UserRole"`)).toEqual([{ s: 'SCHOOL', scopeId: '' }]);
  });
});

describe('subscription and school status', () => {
  it('creates the Standard plan and puts every school on it', async () => {
    const plan = await all<{ key: string; modules: string[] }>(`SELECT "key","modules" FROM "Plan"`);
    expect(plan).toHaveLength(1);
    expect(plan[0].key).toBe('STANDARD');
    expect(plan[0].modules).toContain('finance');
    expect((await all(`SELECT 1 FROM "School" WHERE "planId" IS NULL`))).toHaveLength(0);
  });

  it('carries status, renewal date and student limit across', async () => {
    const rows = await all<{ id: string; status: string; renewalDate: string | null; studentLimit: number | null }>(`SELECT "id","status"::text AS status,"renewalDate"::text AS "renewalDate","studentLimit" FROM "School" ORDER BY "id"`);
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.status, r.renewalDate, r.studentLimit]]))).toEqual({
      s1: ['ACTIVE', null, 800], s2: ['TRIAL', '2026-12-01', 300], s3: ['OVERDUE', '2026-01-31', null], s4: ['SUSPENDED', null, null], s5: ['ACTIVE', null, null],
    });
  });

  it('leaves the old subscription rows in place', async () => {
    expect((await all(`SELECT 1 FROM "Subscription"`))).toHaveLength(4);
  });
});

describe('audit entries and notifications', () => {
  it('keep every entry, and fill in which module each belongs to', async () => {
    const rows = await all<{ id: string; module: string }>(`SELECT "id","module" FROM "AuditLog" ORDER BY "id"`);
    expect(rows).toHaveLength(4);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.module]))).toEqual({ a1: 'finance', a2: 'system', a3: 'students', a4: 'system' });
  });

  it('are still append-only after the one-off fill', async () => {
    await expect(pg.exec(`UPDATE "AuditLog" SET "detail" = 'x'`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(pg.exec(`DELETE FROM "AuditLog"`)).rejects.toThrow(/cannot be changed or deleted/);
  });

  it('write the module, and the caller\'s address and browser when the app set them', async () => {
    await pg.exec(`SELECT set_config('app.ip','203.0.113.5',false), set_config('app.user_agent','Test/1',false)`);
    await pg.exec(`INSERT INTO "AuditLog" ("id","schoolId","actorId","action","entityType","entityId") VALUES ('a5','s1','u-admin','DATA_UPDATE','Payment','p2')`);
    expect((await all(`SELECT "module","ip","userAgent" FROM "AuditLog" WHERE "id" = 'a5'`))[0]).toEqual({ module: 'finance', ip: '203.0.113.5', userAgent: 'Test/1' });
    await pg.exec(`SELECT set_config('app.ip','',false), set_config('app.user_agent','',false)`);
  });

  it('keep the link of every notification, now called link', async () => {
    expect(await all(`SELECT "id","link","type" FROM "Notification" ORDER BY "id"`)).toEqual([
      { id: 'n1', link: '/system/users', type: 'GENERAL' }, { id: 'n2', link: null, type: 'GENERAL' },
    ]);
  });
});

describe('after the migration', () => {
  it('can be run again without changing anything', async () => {
    const snap = async () => JSON.stringify([await all(`SELECT count(*)::int AS n FROM "UserRole"`), await all(`SELECT count(*)::int AS n FROM "RoleDefinition"`), await all(`SELECT count(*)::int AS n FROM "RolePermission"`), await all(`SELECT "id","planId","status"::text AS s FROM "School" ORDER BY "id"`)]);
    const before = await snap();
    await pg.exec(`SELECT seed_school_roles("id") FROM "School"`);
    await applyMigration(pg, '20261030000100_roles_audit_platform_backfill');
    expect(await snap()).toBe(before);
  });

  it('gives a new school its 13 roles, and a new user the role matching their access level', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s9','Brand New')`);
    expect((await all(`SELECT 1 FROM "RoleDefinition" WHERE "schoolId" = 's9'`))).toHaveLength(13);
    await pg.exec(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('u-new','s9','New','new@s9.test','h','BURSAR')`);
    expect(await rolesOf('u-new')).toEqual(['BURSAR']);
    await pg.exec(`UPDATE "User" SET "role" = 'LIBRARIAN' WHERE "id" = 'u-new'`);
    expect(await rolesOf('u-new')).toEqual(['LIBRARIAN']);
  });

  it('refuses to delete a system role', async () => {
    await expect(pg.exec(`DELETE FROM "RoleDefinition" WHERE "schoolId" = 's1' AND "key" = 'TEACHER'`)).rejects.toThrow(/cannot be deleted/);
  });

  it('keeps the platform tables append-only and the invoice rules', async () => {
    await pg.exec(`INSERT INTO "PlatformAdmin" ("id","email","fullName","passwordHash","updatedAt") VALUES ('pa1','x@pfuma.test','X','h', now())`);
    await pg.exec(`INSERT INTO "PlatformAuditLog" ("id","adminId","action","entityType","entityId") VALUES ('pl1','pa1','TEST','School','s1')`);
    await expect(pg.exec(`UPDATE "PlatformAuditLog" SET "detail" = 'x'`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(pg.exec(`DELETE FROM "PlatformAuditLog"`)).rejects.toThrow(/cannot be changed or deleted/);
  });
});
