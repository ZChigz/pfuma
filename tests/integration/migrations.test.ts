// @vitest-environment node
// The three security migrations, run in the order production applies them: on top of
// the wipe + 500-student demo-data migrations, with existing (plaintext) portal links.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

let pg: PGlite;
let schoolId: string;
let legacyTokens: Map<string, string>; // studentId -> plaintext token, as it was before the migrations
let countsBefore: Record<string, number>;

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await pg.query<T>(sql, params)).rows[0];
const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pg.query<T>(sql, params)).rows;

beforeAll(async () => {
  // Everything before the wipe, then a school with users (the demo migration attaches itself to them).
  pg = await createPg('20261016000000_wipe_data_keep_users', { includeData: true });
  await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('sch1','Demo School');`);
  for (const role of ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN']) {
    await pg.query(
      `INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ($1,'sch1',$2,$3,'hash',$4::"Role")`,
      [`u-${role}`, `Demo ${role}`, `${role.toLowerCase()}@demo.test`, role],
    );
  }
  schoolId = 'sch1';

  await applyMigration(pg, '20261016000000_wipe_data_keep_users');
  await applyMigration(pg, '20261016010000_demo_data');

  legacyTokens = new Map((await all<{ id: string; portalToken: string }>(`SELECT "id","portalToken" FROM "Student"`)).map((r) => [r.id, r.portalToken]));
  countsBefore = {
    students: Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Student"`)).n),
    payments: Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Payment"`)).n),
    marks: Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Mark"`)).n),
    users: Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "User"`)).n),
  };

  for (const m of [
    '20261017000000_security_expand',
    '20261017000100_security_backfill',
    '20261017000200_security_rls_audit',
    '20261018000000_results_corrections',
    '20261019000000_absences_and_averages',
    '20261020000000_report_cards',
    '20261021000000_library_members_and_copies',
  ]) await applyMigration(pg, m);
}, 300_000);

afterAll(async () => {
  await pg.close();
});

describe('migrations on top of the live demo data', () => {
  it('start from the demo data the live site has', () => {
    expect(countsBefore.students).toBe(500);
    expect(legacyTokens.size).toBe(500);
  });

  it('lose no rows', async () => {
    for (const [table, key] of [['Student', 'students'], ['Payment', 'payments'], ['Mark', 'marks'], ['User', 'users']] as const) {
      expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`)).n)).toBe(countsBefore[key]);
    }
  });

  it('keep every existing portal link working, as a hash only', async () => {
    const rows = await all<{ id: string; portalToken: string | null; portalTokenHash: string | null }>(
      `SELECT "id","portalToken","portalTokenHash" FROM "Student"`,
    );
    expect(rows).toHaveLength(500);
    for (const r of rows) {
      expect(r.portalToken).toBeNull(); // plaintext is gone
      expect(r.portalTokenHash).toBe(sha256(legacyTokens.get(r.id)!));
    }
    expect(new Set(rows.map((r) => r.portalTokenHash)).size).toBe(500);
  });

  it('give each existing link an expiry within a year', async () => {
    const rows = await all<{ portalTokenExpiresAt: Date; portalTokenCreatedAt: Date }>(
      `SELECT "portalTokenExpiresAt","portalTokenCreatedAt" FROM "Student"`,
    );
    const now = Date.now();
    for (const r of rows) {
      expect(r.portalTokenCreatedAt).toBeInstanceOf(Date);
      expect(r.portalTokenExpiresAt.getTime()).toBeGreaterThan(now - 86_400_000);
      expect(r.portalTokenExpiresAt.getTime()).toBeLessThan(now + 367 * 86_400_000);
    }
  });

  it('can be re-run (the backfill finds nothing left to do)', async () => {
    const before = await all(`SELECT "id","portalTokenHash","portalTokenExpiresAt" FROM "Student" ORDER BY "id"`);
    await pg.exec(fs.readFileSync(path.join(MIGRATIONS, '20261017000100_security_backfill/migration.sql'), 'utf8'));
    expect(await all(`SELECT "id","portalTokenHash","portalTokenExpiresAt" FROM "Student" ORDER BY "id"`)).toEqual(before);
  });

  it('start schools on pass grade C and ranking by average, and copy old results forward', async () => {
    const schools = await all<{ passGrade: string; oLevelRanking: string }>(`SELECT "passGrade","oLevelRanking" FROM "School"`);
    for (const s of schools) expect(s).toEqual({ passGrade: 'C', oLevelRanking: 'AVERAGE' });
    const bad = await one<{ n: string }>(`SELECT count(*) AS n FROM "TermResult" WHERE "subjectsTaken" IS DISTINCT FROM "subjectsSat" OR "averagePercentage" IS DISTINCT FROM "percentage"`);
    expect(Number(bad.n)).toBe(0);
  });

  it('add per-level grade boundaries with the same-school check', async () => {
    const cols = await all<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'GradeBoundary' AND column_name IN ('levelId','termId')`);
    expect(cols).toHaveLength(2);
    const unscoped = await one<{ n: string }>(`SELECT count(*) AS n FROM "GradeBoundary" WHERE "levelId" IS NOT NULL OR "termId" IS NOT NULL`);
    expect(Number(unscoped.n)).toBe(0); // existing boundaries stay school-wide
  });

  it('give every current student a library membership and keep staff members', async () => {
    const students = await one<{ n: string }>(`SELECT count(*) AS n FROM "LibraryMember" WHERE "memberType" = 'STUDENT' AND "studentId" IS NOT NULL AND "userId" IS NULL AND NOT "borrowingSuspended"`);
    expect(Number(students.n)).toBe(500);
    const bad = await one<{ n: string }>(`SELECT count(*) AS n FROM "LibraryMember" WHERE ("userId" IS NOT NULL) = ("studentId" IS NOT NULL)`);
    expect(Number(bad.n)).toBe(0);
    const school = await one<{ libraryFineLimit: string; studentLoanLimit: number; staffLoanLimit: number }>(`SELECT "libraryFineLimit","studentLoanLimit","staffLoanLimit" FROM "School" LIMIT 1`);
    expect(Number(school.libraryFineLimit)).toBe(5);
    expect([school.studentLoanLimit, school.staffLoanLimit]).toEqual([2, 5]);
    const cols = await all(`SELECT 1 FROM information_schema.columns WHERE table_name = 'Book' AND column_name = 'totalCopies'`);
    expect(cols).toHaveLength(0);
  });

  it('give existing users safe defaults', async () => {
    const rows = await all<{ tokenVersion: number; mustChangePassword: boolean }>(`SELECT "tokenVersion","mustChangePassword" FROM "User"`);
    expect(rows.length).toBe(6);
    for (const r of rows) expect(r).toEqual({ tokenVersion: 0, mustChangePassword: false });
  });

  it('turn on forced row-level security on every school-owned table', async () => {
    const tables = await all<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (
          SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'schoolId')`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(29);
    for (const t of tables) {
      expect(t.relrowsecurity, t.relname).toBe(true);
      expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
    for (const name of ['StudentGuardian', 'ExpenseRequestItem']) {
      const r = await one<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [name]);
      expect(r.relrowsecurity, name).toBe(true);
    }
  });

  it('install the audit trigger on the eight core tables', async () => {
    const rows = await all<{ event_object_table: string }>(
      `SELECT DISTINCT event_object_table FROM information_schema.triggers WHERE trigger_name LIKE 'audit\\_%' ESCAPE '\\' AND trigger_name <> 'audit_log_no_change'`,
    );
    expect(rows.map((r) => r.event_object_table).sort()).toEqual(['Charge', 'Enrollment', 'Expense', 'Guardian', 'Mark', 'Payment', 'Student', 'User']);
  });

  it('leave existing (unscoped) queries working: nothing is hidden when no school is set', async () => {
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Student"`)).n)).toBe(500);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "Student" WHERE "schoolId" = $1`, [schoolId])).n)).toBe(500);
  });

  it('hide other schools once a school is set, and write nothing to the audit log without an actor', async () => {
    await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('sch2','Other');`);
    // Superusers bypass row-level security, so look through an ordinary role, as the app does.
    await pg.exec(`CREATE ROLE app_user NOLOGIN; GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user; GRANT USAGE ON SCHEMA public TO app_user;`);
    const auditBefore = Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "AuditLog"`)).n);
    const seen = await pg.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE app_user`);
      await tx.query(`SELECT set_config('app.school_id', 'sch2', true)`);
      return Number((await tx.query<{ n: string }>(`SELECT count(*) AS n FROM "Student"`)).rows[0].n);
    });
    expect(seen).toBe(0);
    // A system write (no app.user_id) is not audited
    await pg.exec(`UPDATE "Student" SET "medicalNotes" = 'x' WHERE "id" = (SELECT "id" FROM "Student" LIMIT 1)`);
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM "AuditLog"`)).n)).toBe(auditBefore);
  });

  it('audit rows never contain portal hashes, PIN hashes or password hashes', async () => {
    await pg.transaction(async (tx) => {
      await tx.query(`SELECT set_config('app.school_id', 'sch1', true), set_config('app.user_id', 'u-ADMIN', true)`);
      await tx.query(`UPDATE "Student" SET "portalPinHash" = 'secretpin', "portalTokenHash" = 'newhash' WHERE "id" = (SELECT "id" FROM "Student" LIMIT 1)`);
      await tx.query(`UPDATE "User" SET "passwordHash" = 'newpw' WHERE "id" = 'u-HEAD'`);
    });
    const rows = await all<{ before: unknown; after: unknown }>(`SELECT "before","after" FROM "AuditLog" WHERE "action" = 'DATA_UPDATE'`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/secretpin|newhash|newpw|passwordHash|portalPinHash|portalTokenHash/);
  });

  it('refuse a row that points into another school, but allow one inside its own school', async () => {
    const student = await one<{ id: string }>(`SELECT "id" FROM "Student" WHERE "schoolId" = 'sch1' LIMIT 1`);
    await expect(
      pg.exec(`INSERT INTO "PortalAccessLog" ("id","schoolId","studentId","ip") VALUES ('p-bad','sch2','${student.id}','1.1.1.1')`),
    ).rejects.toThrow(/Cross-school reference/);
    await pg.exec(`INSERT INTO "PortalAccessLog" ("id","schoolId","studentId","ip") VALUES ('p-ok','sch1','${student.id}','1.1.1.1')`);
  });

  it('refuse a guardian link between schools', async () => {
    await pg.exec(`INSERT INTO "Guardian" ("id","schoolId","fullName","phone") VALUES ('g-other','sch2','Other','+263')`);
    const student = await one<{ id: string }>(`SELECT "id" FROM "Student" WHERE "schoolId" = 'sch1' LIMIT 1`);
    await expect(
      pg.exec(`INSERT INTO "StudentGuardian" ("studentId","guardianId","relationship") VALUES ('${student.id}','g-other','UNCLE')`),
    ).rejects.toThrow(/Cross-school reference/);
  });

  it('make the audit log append-only', async () => {
    await expect(pg.exec(`DELETE FROM "AuditLog"`)).rejects.toThrow(/cannot be changed or deleted/);
    await expect(pg.exec(`UPDATE "AuditLog" SET "detail" = 'x'`)).rejects.toThrow(/cannot be changed or deleted/);
  });
});
