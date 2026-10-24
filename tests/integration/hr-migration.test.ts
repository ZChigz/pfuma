// The HR migrations apply cleanly on top of the earlier ones, the roles get the HR keys, and the people who already have a login
// become employees (teachers government-paid, everyone else school-paid) without losing or duplicating anything.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const q = async (sql: string) => (await pg.query(sql)).rows as Record<string, unknown>[];

beforeAll(async () => {
  pg = await createPg('20261105000000_hr_full_enums');
  await pg.exec(`INSERT INTO "School" ("id", "name") VALUES ('s1', 'Alpha'), ('s2', 'Beta')`);
  const users: [string, string, string, string, string][] = [
    ['u1', 's1', 'Tendai Moyo', 'TEACHER', 'a1@x.test'], ['u2', 's1', 'Rudo Chari', 'BURSAR', 'a2@x.test'], ['u3', 's1', 'Head Teacher', 'HEAD', 'a3@x.test'],
    ['u4', 's1', 'Madonna', 'ADMIN', 'a4@x.test'], ['u5', 's2', 'Other School Teacher', 'TEACHER', 'b1@x.test'],
  ];
  for (const [id, school, name, role, email] of users) {
    await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role", "createdAt") VALUES ('${id}', '${school}', '${name}', '${email}', 'x', '${role}', now() + interval '${id.slice(1)} minutes')`);
  }
  await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role", "active") VALUES ('u6', 's1', 'Left Long Ago', 'a6@x.test', 'x', 'TEACHER', false)`);
  await pg.exec(`INSERT INTO "User" ("id", "schoolId", "fullName", "email", "passwordHash", "role", "isSupport") VALUES ('u7', 's1', 'Pfuma Support', 'a7@x.test', 'x', 'ADMIN', true)`);
});
afterAll(async () => { await pg?.close(); });

describe('HR migrations', () => {
  it('apply on top of the earlier ones', async () => {
    await applyMigration(pg, '20261105000000_hr_full_enums');
    await applyMigration(pg, '20261105000100_hr_core');
    await applyMigration(pg, '20261105000200_hr_core_backfill');
    const t = await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('Employee','HrPayrollRun','HrPayrollLine','Payslip','LeaveRequest','StaffAttendance','DutyRoster','TaxTable')`);
    expect(t[0]!.n).toBe(8);
  });

  it('every active login (not support, not inactive) becomes an employee, numbered per school in the order the logins were made', async () => {
    const e = await q(`SELECT "userId", "employeeNo", "firstName", "surname", "employer", "category", "jobTitle", "status" FROM "Employee" ORDER BY "schoolId", "employeeNo"`);
    expect(e.map((r) => [r.userId, r.employeeNo])).toEqual([['u1', 'EMP-0001'], ['u2', 'EMP-0002'], ['u3', 'EMP-0003'], ['u4', 'EMP-0004'], ['u5', 'EMP-0001']]);
    const byUser = Object.fromEntries(e.map((r) => [r.userId as string, r]));
    expect(byUser.u1).toMatchObject({ firstName: 'Tendai', surname: 'Moyo', employer: 'GOVERNMENT', category: 'TEACHING', jobTitle: 'Teacher', status: 'ACTIVE' });
    expect(byUser.u2).toMatchObject({ employer: 'SCHOOL', category: 'ADMINISTRATION', jobTitle: 'Bursar' });
    expect(byUser.u3).toMatchObject({ employer: 'GOVERNMENT', jobTitle: 'Head' });
    expect(byUser.u4).toMatchObject({ firstName: 'Madonna', surname: 'Madonna', employer: 'SCHOOL', jobTitle: 'Administrator' });
    expect(byUser.u6).toBeUndefined();
    expect(byUser.u7).toBeUndefined();
  });

  it('the next employee number carries on, and running the data step again changes nothing', async () => {
    expect((await q(`SELECT "nextNumber" FROM "HrSequence" WHERE "schoolId" = 's1' AND "key" = 'EMP'`))[0]!.nextNumber).toBe(5);
    await pg.exec(await (await import('node:fs/promises')).readFile(require('node:path').resolve(__dirname, '../../prisma/migrations/20261105000200_hr_core_backfill/migration.sql'), 'utf8'));
    expect((await q(`SELECT count(*)::int AS n FROM "Employee"`))[0]!.n).toBe(5);
  });

  it('gives the HR keys to the roles', async () => {
    const k = await q(`SELECT hr_role_keys('HR_OFFICER') AS k`);
    expect(k[0]!.k).toContain('hr.payroll.prepare');
    expect(k[0]!.k).not.toContain('hr.payroll.approve');
    const t = await q(`SELECT hr_role_keys('TEACHER') AS k`);
    expect(t[0]!.k).toEqual(expect.arrayContaining(['hr.self.payslips', 'hr.leave.request']));
    expect(t[0]!.k).not.toContain('hr.pay.view');
    expect((await q(`SELECT count(*)::int AS n FROM "Permission" WHERE "module" = 'hr'`))[0]!.n).toBeGreaterThanOrEqual(33);
  });
});
