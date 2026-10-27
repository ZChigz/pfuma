// @vitest-environment node
// The access seed (prisma/seed/access.ts): the data says what the access document says, the migration is that data, and running it
// on a school that already exists (or adding a new one) leaves every role holding exactly its grants.
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../lib/access-core';
import { ROLES, SYSTEM_ROLE_KEYS, TRANSITIONAL_WILDCARD, accessMigrationSql, accessSeedStatements, catalogue, expandGrants, grantRows, isSensitiveKey } from '../../prisma/seed/access';
import { applyMigration, createPg } from '../helpers/test-db';

const role = (key: string) => ROLES.find((r) => r.key === key)!;
const held = (key: string) => expandGrants(role(key));
const has = (r: string, k: string) => held(r).has(k);
const scopeOf = (r: string, k: string) => held(r).get(k);

describe('the data', () => {
  it('has the 14 system roles and the 4 templates', () => {
    expect(SYSTEM_ROLE_KEYS).toEqual(['OWNER', 'HEAD', 'DEPUTY_HEAD', 'ADMINISTRATOR', 'BURSAR', 'ACCOUNTS_CLERK', 'HR_OFFICER', 'HOD', 'TEACHER', 'CLASS_TEACHER', 'EXAMS_OFFICER', 'LIBRARIAN', 'BOARDING_MASTER', 'MATRON']);
    expect(ROLES.filter((r) => r.copiedFrom).map((r) => r.key)).toEqual(['STOREKEEPER', 'TRANSPORT_OFFICER', 'TUCKSHOP_ATTENDANT', 'NURSE']);
  });

  it('names only keys that exist (a pattern that matches nothing is an error)', () => {
    for (const r of ROLES) expect(() => expandGrants(r), r.key).not.toThrow();
  });

  it('puts every key of the catalogue in the right module, page and action, and the document\'s keys in it', () => {
    const keys = catalogue();
    for (const c of keys) expect(c.key).toBe(`${c.module}.${c.page}.${c.action}`);
    const all = new Set(keys.map((c) => c.key));
    for (const k of ['facilities.transport.view', 'communication.broadcast.school', 'communication.send.group', 'communication.reminders.send', 'communication.templates.manage', 'communication.log.view',
      'finance.payments.verify', 'hr.attendance.self', 'exams.zimsec.results_import', 'system.subscription.view']) expect(all.has(k), k).toBe(true);
    expect(all.size).toBe(Object.keys(PERMISSIONS).filter((k) => !k.startsWith('account.')).length);
  });

  it('marks the sensitive keys', () => {
    for (const k of ['students.medical.view', 'students.guardians.view_ids', 'students.discipline.view', 'hr.pay.view', 'hr.discipline.view', 'hr.payroll.approve', 'finance.payments.void',
      'finance.charges.void', 'finance.expenses.void', 'finance.refunds.approve', 'system.roles.edit', 'finance.reports.export', 'students.profiles.export']) expect(isSensitiveKey(k), k).toBe(true);
    for (const k of ['students.profiles.view', 'finance.payments.record', 'hr.leave.request']) expect(isSensitiveKey(k), k).toBe(false);
  });

  it('gives every staff user the base grants through every role, at SELF where the document says so', () => {
    for (const r of ROLES) {
      for (const k of ['system.dashboard.view', 'system.calendar.view', 'hr.directory.view']) expect(has(r.key, k), `${r.key} ${k}`).toBe(true);
      for (const k of ['hr.self.payslips', 'hr.self.leave', 'hr.self.details', 'hr.leave.request', 'hr.attendance.self', 'finance.requests.create']) expect(scopeOf(r.key, k), `${r.key} ${k}`).toBe('SELF');
    }
    expect(scopeOf('HR_OFFICER', 'hr.duties.view')).toBe('SCHOOL'); // hr.* is wider than the base SELF
    expect(scopeOf('TEACHER', 'academics.timetable.view')).toBe('SELF');
  });

  describe('Owner', () => {
    it('sees everything and holds the owner-only actions', () => {
      for (const [k] of catalogue().filter((c) => c.action === 'view' || c.action === 'export').map((c) => [c.key])) expect(has('OWNER', k!), k).toBe(true);
      for (const k of ['system.subscription.view', 'system.roles.edit', 'system.users.create', 'system.users.deactivate', 'finance.payments.void', 'finance.charges.void', 'finance.expenses.void',
        'finance.refunds.approve', 'finance.requests.approve', 'hr.payroll.approve', 'hr.posts.approve', 'hr.pay.view', 'facilities.assets.dispose', 'students.medical.view', 'communication.broadcast.school']) expect(has('OWNER', k), k).toBe(true);
    });
    it('never records payments, enters marks or prepares payroll', () => {
      for (const k of ['finance.payments.record', 'finance.payments.verify', 'exams.marks.enter', 'exams.marks.submit', 'hr.payroll.prepare', 'finance.cashup.submit']) expect(has('OWNER', k), k).toBe(false);
    });
  });

  describe('Head', () => {
    it('approves what the school decides and publishes results', () => {
      for (const k of ['students.admissions.approve', 'students.enrolment.approve', 'students.promotion.approve', 'students.discipline.approve', 'students.leavers.approve', 'academics.subjects.approve',
        'academics.assignments.approve', 'academics.timetable.approve', 'academics.schemes.approve', 'exams.marks.unlock', 'exams.results.publish', 'exams.results.unpublish', 'exams.comments.head',
        'exams.zimsec.approve', 'finance.fees.approve', 'finance.adjustments.approve', 'finance.awards.approve', 'finance.plans.approve', 'finance.requests.approve', 'finance.cashup.signoff',
        'finance.reports.view', 'finance.reports.export', 'hr.leave.approve', 'hr.duties.approve', 'facilities.exeats.approve', 'facilities.inventory.writeoff', 'facilities.assets.dispose', 'system.audit.view']) expect(has('HEAD', k), k).toBe(true);
    });
    it('never voids or refunds money, or pays', () => {
      for (const k of ['finance.payments.void', 'finance.charges.void', 'finance.expenses.void', 'finance.refunds.approve', 'finance.payments.record', 'hr.pay.view', 'hr.payroll.approve']) expect(has('HEAD', k), k).toBe(false);
    });
  });

  describe('Administrator', () => {
    it('runs the system and student records but has no approvals, no money and no staff pay', () => {
      for (const k of ['system.settings.edit', 'system.users.create', 'system.roles.view', 'system.audit.view', 'students.profiles.edit', 'students.medical.view', 'academics.classes.manage', 'communication.templates.manage']) expect(has('ADMINISTRATOR', k), k).toBe(true);
      expect(has('ADMINISTRATOR', 'system.roles.edit')).toBe(false);
      expect(has('ADMINISTRATOR', 'students.medical.export')).toBe(false);
      for (const c of catalogue().filter((c) => c.action === 'approve')) expect(has('ADMINISTRATOR', c.key), c.key).toBe(false);
      for (const c of catalogue().filter((c) => c.module === 'finance' && !['requests', 'arrears'].includes(c.page))) expect(has('ADMINISTRATOR', c.key), c.key).toBe(false);
      for (const k of ['hr.pay.view', 'hr.payroll.view', 'hr.payroll.approve']) expect(has('ADMINISTRATOR', k), k).toBe(false);
    });
  });

  describe('Bursar and Accounts Clerk', () => {
    it('the Bursar holds finance except what must be someone else\'s', () => {
      for (const k of ['finance.payments.record', 'finance.payments.verify', 'finance.payments.allocate', 'finance.refunds.request', 'finance.refunds.pay', 'finance.requests.disburse', 'finance.cashup.confirm',
        'finance.bank.reconcile', 'finance.payroll.pay', 'finance.fees.manage', 'hr.payroll.view', 'facilities.transport.manage', 'facilities.inventory.receive', 'facilities.tuckshop.cashup', 'communication.reminders.send']) expect(has('BURSAR', k), k).toBe(true);
      for (const k of ['finance.payments.void', 'finance.charges.void', 'finance.expenses.void', 'finance.refunds.approve', 'finance.requests.approve', 'finance.fees.approve', 'finance.adjustments.approve',
        'finance.awards.approve', 'finance.plans.approve', 'finance.cashup.signoff', 'facilities.inventory.writeoff', 'hr.payroll.approve', 'hr.pay.view']) expect(has('BURSAR', k), k).toBe(false);
    });
    it('the Clerk records, counts the own cash-up and sees only what they recorded', () => {
      expect(scopeOf('ACCOUNTS_CLERK', 'finance.payments.record')).toBe('RECORDED_BY_ME');
      expect(scopeOf('ACCOUNTS_CLERK', 'finance.cashup.submit')).toBe('RECORDED_BY_ME');
      expect(scopeOf('ACCOUNTS_CLERK', 'finance.payments.view')).toBe('RECORDED_BY_ME');
      for (const k of ['finance.payments.verify', 'finance.cashup.confirm', 'finance.payments.void', 'finance.reports.view']) expect(has('ACCOUNTS_CLERK', k), k).toBe(false);
    });
  });

  describe('HR Officer', () => {
    it('holds HR except approving payroll, posts and leave, and sees only their own payslip', () => {
      for (const k of ['hr.employees.manage', 'hr.pay.view', 'hr.pay.manage', 'hr.payroll.prepare', 'hr.payroll.settings', 'hr.discipline.manage', 'hr.recruitment.manage', 'academics.assignments.view']) expect(has('HR_OFFICER', k), k).toBe(true);
      for (const k of ['hr.payroll.approve', 'hr.posts.approve', 'hr.leave.approve', 'finance.payroll.pay']) expect(has('HR_OFFICER', k), k).toBe(false);
      expect(scopeOf('HR_OFFICER', 'hr.self.payslips')).toBe('SELF');
    });
  });

  describe('teaching roles are scoped', () => {
    it('HOD at DEPARTMENT, Teacher at ASSIGNED, Class Teacher at CLASS', () => {
      for (const k of ['exams.marks.verify', 'academics.schemes.approve', 'students.discipline.view']) expect(scopeOf('HOD', k), k).toBe('DEPARTMENT');
      for (const k of ['exams.marks.enter', 'exams.marks.submit', 'academics.attendance.mark', 'students.profiles.view']) expect(scopeOf('TEACHER', k), k).toBe('ASSIGNED');
      for (const k of ['academics.attendance.mark', 'exams.comments.class', 'finance.arrears.flag', 'students.discipline.view', 'facilities.hostel.view']) expect(scopeOf('CLASS_TEACHER', k), k).toBe('CLASS');
    });
    it('a teacher sees no fees and no medical details; a class teacher sees the arrears flag but no amounts', () => {
      for (const r of ['TEACHER', 'CLASS_TEACHER', 'HOD']) for (const k of ['finance.statements.view', 'students.medical.view', 'finance.payments.view', 'finance.fees.view']) expect(has(r, k), `${r} ${k}`).toBe(false);
      expect(has('CLASS_TEACHER', 'finance.arrears.flag')).toBe(true);
    });
  });

  describe('Boarding Master and Matron are separate', () => {
    it('only the Matron sees medical details', () => {
      expect(has('MATRON', 'students.medical.view')).toBe(true);
      expect(has('MATRON', 'students.medical.edit')).toBe(true);
      expect(has('BOARDING_MASTER', 'students.medical.view')).toBe(false);
      expect(has('BOARDING_MASTER', 'facilities.sickbay.view')).toBe(true);
      expect(has('BOARDING_MASTER', 'facilities.sickbay.record')).toBe(false);
      expect(has('MATRON', 'facilities.exeats.signout')).toBe(false);
      expect(scopeOf('MATRON', 'facilities.sickbay.record')).toBe('HOSTEL');
      expect(scopeOf('MATRON', 'facilities.inventory.issue')).toBe('STORE');
      expect(scopeOf('BOARDING_MASTER', 'facilities.exeats.signout')).toBe('HOSTEL');
    });
  });

  it('keeps a template inside the role it was copied from, apart from scope (a custom role can only remove keys)', () => {
    for (const t of ROLES.filter((r) => r.copiedFrom)) {
      const own = Array.from(held(t.key).keys()), parent = held(t.copiedFrom!);
      for (const k of own) expect(parent.has(k), `${t.key} has ${k} but ${t.copiedFrom} does not`).toBe(true);
    }
  });

  it('gives the older keys to the roles that hold what they stand for, and no role more than that', () => {
    expect(has('BURSAR', 'finance.payments.view')).toBe(true);
    expect(has('HEAD', 'finance.fees.view')).toBe(true); // through finance.fees.approve
    expect(has('ADMINISTRATOR', 'finance.payments.view')).toBe(false);
    expect(has('TEACHER', 'students.list.view')).toBe(true);
    expect(scopeOf('TEACHER', 'students.list.view')).toBe('ASSIGNED');
    expect(has('BOARDING_MASTER', 'hr.staff.view')).toBe(false);
  });

  it('adds a few keys the document does not name, each for a stated reason, and no more', () => {
    // The Academics pages open on these for the teacher's own classes.
    expect(scopeOf('TEACHER', 'academics.classes.view')).toBe('ASSIGNED');
    expect(scopeOf('TEACHER', 'academics.subjects.view')).toBe('ASSIGNED');
    expect(scopeOf('TEACHER', 'academics.schemes.view')).toBe('ASSIGNED');
    expect(has('TEACHER', 'academics.attendance.view')).toBe(false); // the summary is the class teacher's
    expect(scopeOf('CLASS_TEACHER', 'academics.attendance.view')).toBe('CLASS');
    // Attendance and schemes do not bring discipline history or medical details with them.
    for (const k of ['students.discipline.view', 'students.medical.view', 'students.guardians.view_ids']) expect(has('TEACHER', k), k).toBe(false);
    // The money controls are the owner's; the tax tables are confirmed by the bursar, not by whoever prepares payroll.
    expect(has('OWNER', 'finance.settings.manage')).toBe(true);
    expect(has('BURSAR', 'finance.settings.manage')).toBe(false);
    expect(has('BURSAR', 'hr.payroll.settings')).toBe(true);
    expect(has('HR_OFFICER', 'hr.payroll.settings')).toBe(true);
    // Reopening a closed term stays the Owner's alone; the class teacher keeps the at-risk list of their own class.
    expect(has('OWNER', 'system.terms.reopen')).toBe(true);
    for (const r of SYSTEM_ROLE_KEYS.filter((k) => k !== 'OWNER')) expect(has(r, 'system.terms.reopen'), r).toBe(false);
    expect(scopeOf('CLASS_TEACHER', 'exams.analytics.view')).toBe('CLASS');
    // The Deputy can be the alternate verifier of a mark sheet, which needs the key; being named the alternate is still what lets them verify.
    expect(has('DEPUTY_HEAD', 'exams.marks.verify')).toBe(true);
  });

  it('gives no role "*": the Owner and the Administrator hold the keys listed for them, and nothing else', () => {
    expect(TRANSITIONAL_WILDCARD).toEqual([]);
    expect(grantRows().filter((g) => g.key === '*')).toEqual([]);
    // The Administrator has no approvals, no money and no staff pay; the Owner never does the steps that must be someone else's.
    for (const k of ['finance.payments.verify', 'finance.payments.record', 'hr.pay.view', 'hr.payroll.approve', 'exams.marks.enter', 'academics.timetable.edit']) expect(has('ADMINISTRATOR', k), `Administrator ${k}`).toBe(false);
    for (const k of ['finance.payments.record', 'exams.marks.enter', 'hr.payroll.prepare']) expect(has('OWNER', k), `Owner ${k}`).toBe(false);
  });
});

describe('the migration', () => {
  it('is exactly the seed data (write it again with prisma/seed/write-access-migration.ts after changing prisma/seed/access.ts)', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../prisma/migrations/20261109000300_access_seed/migration.sql'), 'utf8');
    expect(file).toBe(accessMigrationSql());
    expect(accessSeedStatements()).toHaveLength(4);
  });
});

describe('in a database', () => {
  let pg: PGlite;
  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
  const grantsIn = async (school: string, key: string) =>
    Object.fromEntries((await all<{ k: string; s: string }>(`SELECT rp."permissionKey" AS k, rp."scope"::text AS s FROM "RolePermission" rp JOIN "RoleDefinition" rd ON rd."id" = rp."roleId" WHERE rd."schoolId" = $1 AND rd."key" = $2`, [school, key])).map((r) => [r.k, r.s]));
  const expected = (key: string) => Object.fromEntries(grantRows().filter((g) => g.role === key).map((g) => [g.key, g.scope]));
  const versions = async () => Object.fromEntries((await all<{ id: string; v: number }>(`SELECT "id", "permVersion" AS v FROM "User" ORDER BY "id"`)).map((r) => [r.id, r.v]));

  beforeAll(async () => {
    pg = await createPg('20261109000300_access_seed');
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s1','Old School');`);
    for (const [id, r] of [['head', 'HEAD'], ['teacher', 'TEACHER'], ['bursar', 'BURSAR']]) {
      await pg.query(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ($1,'s1',$1,$2,'hash',$3::"Role")`, [id, `${id}@x.test`, r]);
    }
    // A grant somebody gave the Teacher role through the old screen, which the access document does not give a teacher.
    await pg.exec(`INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey","updatedAt")
      SELECT 'extra1','s1',"id",'finance.payments.void',now() FROM "RoleDefinition" WHERE "schoolId"='s1' AND "key"='TEACHER'`);
    await applyMigration(pg, '20261109000300_access_seed');
  }, 300_000);
  afterAll(async () => { await pg.close(); });

  it('gives an existing school the 14 system roles and the 4 templates', async () => {
    const roles = await all<{ key: string; isSystem: boolean }>(`SELECT "key","isSystem" FROM "RoleDefinition" WHERE "schoolId"='s1' ORDER BY "key"`);
    expect(roles.filter((r) => r.isSystem).map((r) => r.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    expect(roles.filter((r) => !r.isSystem).map((r) => r.key)).toEqual(['NURSE', 'STOREKEEPER', 'TRANSPORT_OFFICER', 'TUCKSHOP_ATTENDANT']);
    expect(await all(`SELECT 1 FROM "RoleDefinition" WHERE "schoolId"='s1' AND "key"='STOREKEEPER' AND "copiedFromRoleId" = (SELECT "id" FROM "RoleDefinition" WHERE "schoolId"='s1' AND "key"='BURSAR')`)).toHaveLength(1);
  });

  it('leaves every role holding exactly its grants, each at its scope', async () => {
    for (const r of ROLES) expect(await grantsIn('s1', r.key), r.key).toEqual(expected(r.key));
  });

  it('takes away a grant the document does not give, and the "*" the Owner and the Administrator used to hold', async () => {
    expect((await grantsIn('s1', 'TEACHER'))['finance.payments.void']).toBeUndefined();
    for (const r of ['OWNER', 'ADMINISTRATOR', 'HEAD']) expect((await grantsIn('s1', r))['*'], r).toBeUndefined();
  });

  it('makes people pick the change up (permVersion moves) and keeps everyone\'s roles', async () => {
    expect(Object.values(await versions()).every((v) => v === 1)).toBe(true);
    expect((await all<{ k: string }>(`SELECT rd."key" AS k FROM "UserRole" ur JOIN "RoleDefinition" rd ON rd."id"=ur."roleId" WHERE ur."userId"='teacher'`)).map((r) => r.k)).toEqual(['TEACHER']);
  });

  it('can be run again: nothing changes, nobody\'s permVersion moves', async () => {
    const before = JSON.stringify(await all(`SELECT "roleId","permissionKey","scope"::text FROM "RolePermission" ORDER BY 1,2`));
    await pg.exec(`SELECT seed_school_roles('s1')`);
    expect(JSON.stringify(await all(`SELECT "roleId","permissionKey","scope"::text FROM "RolePermission" ORDER BY 1,2`))).toBe(before);
    expect(Object.values(await versions()).every((v) => v === 1)).toBe(true);
  });

  it('corrects a changed grant on a system role, but leaves a school\'s own changes to a template alone', async () => {
    await pg.exec(`UPDATE "RolePermission" SET "scope" = 'SELF' WHERE "permissionKey" = 'exams.marks.enter' AND "roleId" = (SELECT "id" FROM "RoleDefinition" WHERE "schoolId"='s1' AND "key"='TEACHER')`);
    await pg.exec(`DELETE FROM "RolePermission" WHERE "permissionKey" = 'facilities.inventory.count' AND "roleId" = (SELECT "id" FROM "RoleDefinition" WHERE "schoolId"='s1' AND "key"='STOREKEEPER')`);
    await pg.exec(`SELECT seed_school_roles('s1')`);
    expect((await grantsIn('s1', 'TEACHER'))['exams.marks.enter']).toBe('ASSIGNED');
    expect((await grantsIn('s1', 'STOREKEEPER'))['facilities.inventory.count']).toBeUndefined();
    expect((await versions()).teacher).toBe(2);
  });

  it('gives a school added later the same roles and grants', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s2','New School')`);
    for (const r of ROLES) expect(await grantsIn('s2', r.key), r.key).toEqual(expected(r.key));
  });

  it('flags the sensitive keys in the catalogue and keeps every key\'s page and action', async () => {
    const rows = await all<{ key: string; isSensitive: boolean }>(`SELECT "key","isSensitive" FROM "Permission" WHERE "key" <> '*'`);
    for (const r of rows) expect(r.isSensitive, r.key).toBe(isSensitiveKey(r.key));
    expect(rows.map((r) => r.key).sort()).toEqual(catalogue().map((c) => c.key).sort());
  });
});

describe('the switch migration (20261109000400)', () => {
  let pg: PGlite;
  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;

  beforeAll(async () => {
    pg = await createPg('20261109000300_access_seed');
    await applyMigration(pg, '20261109000300_access_seed');
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s1','Old School')`);
    await pg.exec(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('u1','s1','U One','u1@x.test','hash','TEACHER'), ('u2','s1','U Two','u2@x.test','hash','TEACHER')`);
    // A custom role somebody gave full access to, held by u1 (u2 holds only the Teacher role).
    await pg.exec(`INSERT INTO "RoleDefinition" ("id","schoolId","key","name","description","isSystem","updatedAt") VALUES ('r-custom','s1','EVERYTHING','Everything','Test',false,now())`);
    await pg.exec(`INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey","updatedAt") VALUES ('p-star','s1','r-custom','*',now())`);
    await pg.exec(`INSERT INTO "UserRole" ("id","schoolId","userId","roleId","updatedAt") VALUES ('ur1','s1','u1','r-custom',now())`);
    await applyMigration(pg, '20261109000400_access_switch');
  }, 300_000);
  afterAll(async () => { await pg.close(); });

  it('takes the wildcard away from any role that still held it, and tells only the people who held it', async () => {
    expect(await all(`SELECT 1 FROM "RolePermission" WHERE "permissionKey" = '*'`)).toHaveLength(0);
    const v = Object.fromEntries((await all<{ id: string; v: number }>(`SELECT "id", "permVersion" AS v FROM "User"`)).map((r) => [r.id, r.v]));
    expect(v.u1).toBeGreaterThan(v.u2!);
  });

  it('makes the database refuse the wildcard from then on', async () => {
    await expect(pg.exec(`INSERT INTO "RolePermission" ("id","schoolId","roleId","permissionKey","updatedAt") VALUES ('p-again','s1','r-custom','*',now())`)).rejects.toThrow(/no_wildcard|check constraint/i);
    await expect(pg.exec(`SELECT seed_school_roles('s1')`)).resolves.toBeDefined();
  });
});
