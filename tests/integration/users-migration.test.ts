// @vitest-environment node
// The users migrations applied on top of staff who already exist.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigration, createPg } from '../helpers/test-db';

let pg: PGlite;
const all = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => (await pg.query<T>(sql)).rows;

beforeAll(async () => {
  pg = await createPg('20261029000000_users_roles_invites');
  await pg.exec(`INSERT INTO "School" ("id","name") VALUES ('s1','Old School');`);
  for (const role of ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN']) {
    await pg.query(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role","active","mustChangePassword") VALUES ($1,'s1',$2,$3,'hash',$4::"Role",$5,$6)`, [`u-${role}`, `Old ${role}`, `${role.toLowerCase()}@old.test`, role, role !== 'LIBRARIAN', role === 'TEACHER']);
  }
  await pg.exec(`INSERT INTO "PasswordResetToken" ("id","schoolId","userId","tokenHash","expiresAt","createdById") VALUES ('t1','s1','u-TEACHER','hash1', now() + interval '30 minutes','u-ADMIN');`);
  await applyMigration(pg, '20261029000000_users_roles_invites');
  await applyMigration(pg, '20261029000100_users_roles_invites_backfill');
}, 300_000);

afterAll(async () => { await pg.close(); });

describe('users migrations', () => {
  it('lose nobody and change nobody\'s access', async () => {
    const rows = await all<{ id: string; role: string; active: boolean; email: string }>(`SELECT "id","role"::text AS role,"active","email" FROM "User" ORDER BY "id"`);
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.id === 'u-ADMIN')).toMatchObject({ role: 'ADMIN', active: true, email: 'admin@old.test' });
    expect(rows.find((r) => r.id === 'u-LIBRARIAN')?.active).toBe(false);
  });

  it('give each existing user the staff role that matches the access they already have', async () => {
    const rows = await all<{ role: string; staffRoles: string[] }>(`SELECT "role"::text AS role, "staffRoles"::text[] AS "staffRoles" FROM "User" ORDER BY "role"`);
    expect(Object.fromEntries(rows.map((r) => [r.role, r.staffRoles]))).toEqual({
      ADMIN: ['SCHOOL_ADMINISTRATOR'], DIRECTOR: ['OWNER'], HEAD: ['HEAD_TEACHER'], BURSAR: ['BURSAR'], TEACHER: ['TEACHER'], LIBRARIAN: ['LIBRARIAN'],
    });
  });

  it('read existing users as Active (no pending invite) and leave phone and title empty', async () => {
    for (const r of await all<Record<string, unknown>>(`SELECT "invitePending","invitedAt","phone","title" FROM "User"`)) {
      expect(r).toEqual({ invitePending: false, invitedAt: null, phone: null, title: null });
    }
    expect((await all<{ mustChangePassword: boolean }>(`SELECT "mustChangePassword" FROM "User" WHERE "id" = 'u-TEACHER'`))[0].mustChangePassword).toBe(true); // untouched
  });

  it('keep existing reset links as reset links', async () => {
    expect((await all<{ kind: string }>(`SELECT "kind"::text AS kind FROM "PasswordResetToken"`))[0].kind).toBe('RESET');
  });

  it('can be run again without changing anything', async () => {
    const before = JSON.stringify(await all(`SELECT "id","staffRoles"::text[] FROM "User" ORDER BY "id"`));
    await applyMigration(pg, '20261029000100_users_roles_invites_backfill');
    expect(JSON.stringify(await all(`SELECT "id","staffRoles"::text[] FROM "User" ORDER BY "id"`))).toBe(before);
  });

  it('fill staff roles from the role for code that does not know about them, and follow a changed role', async () => {
    await pg.exec(`INSERT INTO "User" ("id","schoolId","fullName","email","passwordHash","role") VALUES ('n1','s1','New','new@old.test','h','BURSAR')`);
    expect((await all<{ r: string[] }>(`SELECT "staffRoles"::text[] AS r FROM "User" WHERE "id" = 'n1'`))[0].r).toEqual(['BURSAR']);
    await pg.exec(`UPDATE "User" SET "role" = 'HEAD' WHERE "id" = 'n1'`);
    expect((await all<{ r: string[] }>(`SELECT "staffRoles"::text[] AS r FROM "User" WHERE "id" = 'n1'`))[0].r).toEqual(['HEAD_TEACHER']);
    // several roles chosen on purpose are kept, even when the role moves with them
    await pg.exec(`UPDATE "User" SET "role" = 'BURSAR', "staffRoles" = ARRAY['ACCOUNTS_CLERK','REGISTRAR']::"StaffRole"[] WHERE "id" = 'n1'`);
    expect((await all<{ r: string[] }>(`SELECT "staffRoles"::text[] AS r FROM "User" WHERE "id" = 'n1'`))[0].r).toEqual(['ACCOUNTS_CLERK', 'REGISTRAR']);
    // an unrelated update leaves them alone
    await pg.exec(`UPDATE "User" SET "fullName" = 'Renamed' WHERE "id" = 'n1'`);
    expect((await all<{ r: string[] }>(`SELECT "staffRoles"::text[] AS r FROM "User" WHERE "id" = 'n1'`))[0].r).toEqual(['ACCOUNTS_CLERK', 'REGISTRAR']);
  });

  it('refuse a bad phone or title in the database', async () => {
    const bad = (set: string) => pg.exec(`UPDATE "User" SET ${set} WHERE "id" = 'u-ADMIN'`);
    await expect(bad(`"phone" = '0771234567'`)).rejects.toThrow();
    await expect(bad(`"phone" = '+27821234567'`)).rejects.toThrow();
    await expect(bad(`"title" = 'Prof'`)).rejects.toThrow();
    await bad(`"phone" = '+263771234567', "title" = 'Mr'`);
  });

  it('know the 13 roles and the two kinds of password link', async () => {
    const roles = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'StaffRole'`)).map((r) => r.enumlabel);
    expect(roles).toHaveLength(13);
    const kinds = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PasswordTokenKind'`)).map((r) => r.enumlabel).sort();
    expect(kinds).toEqual(['INVITE', 'RESET']);
    const actions = (await all<{ enumlabel: string }>(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'AuditAction'`)).map((r) => r.enumlabel);
    for (const a of ['INVITE_USER', 'ACCEPT_INVITE', 'IMPORT_USERS']) expect(actions).toContain(a);
  });
});
