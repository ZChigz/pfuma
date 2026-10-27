// @vitest-environment node
// A change of access is felt quickly. The server reads the person's roles and exceptions from the database on every request, so a
// removed permission stops working at once; the session token only carries a copy of the roles and permVersion, which is read again
// at least every 60 seconds so the menu and the pages that read the token catch up, and a deactivated person is signed out.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let check: typeof import('@/lib/session-check');
let admin: typeof import('@/lib/system/access-admin');
let scoped: typeof import('@/lib/scoped-db');
let ownerCtx: Awaited<ReturnType<typeof actorOf>>;

const T0 = 1_800_000_000_000;
const db = (c: { schoolId: string; id: string }) => scoped.getScopedDb(c.schoolId, c.id);
const rowOf = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { permVersion: true, tokenVersion: true, fullName: true, mustChangePassword: true, role: true, schoolId: true } });

/** The token the person was given when they signed in, as of `at`. */
async function tokenFor(id: string, at = T0) {
  const row = await rowOf(id);
  const roles = (await prisma.userRole.findMany({ where: { userId: id }, select: { role: { select: { key: true } } } })).map((r) => r.role.key);
  return { id, schoolId: row.schoolId, role: row.role, fullName: row.fullName, tokenVersion: row.tokenVersion, mustChangePassword: row.mustChangePassword, roles, permVersion: row.permVersion, checkedAt: at };
}

/** A role that holds only the permission to see the user list. */
async function seeUsersRole() {
  const key = 'FRESH_USER_LIST';
  const existing = await prisma.roleDefinition.findFirst({ where: { schoolId: A.schoolId, key } });
  if (existing) return existing;
  const role = await prisma.roleDefinition.create({ data: { schoolId: A.schoolId, key, name: 'Fresh user list', description: 'Test role', isSystem: false } });
  await prisma.rolePermission.create({ data: { schoolId: A.schoolId, roleId: role.id, permissionKey: 'system.users.view', scope: 'SCHOOL' } });
  return role;
}

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  [check, admin, scoped] = await Promise.all([import('@/lib/session-check'), import('@/lib/system/access-admin'), import('@/lib/scoped-db')]);
  A = await seedSchool(prisma, 'School A');
  ownerCtx = await actorOf(prisma, A.users.DIRECTOR.id);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('the session token is trusted for 60 seconds, then read again', () => {
  it('keeps the same token inside the minute and reads the database at the minute', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'minute');
    const token = await tokenFor(person.id);
    expect(check.RECHECK_INTERVAL_MS).toBe(60_000);
    const inside = await check.revalidateToken(token, T0 + 59_999);
    expect(inside).toBe(token);
    const at = await check.revalidateToken(token, T0 + 60_000);
    expect(at).not.toBe(token);
    expect(at!.checkedAt).toBe(T0 + 60_000);
  });

  it('a role given moves permVersion, and the new token carries the role and the new version', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'given');
    const token = await tokenFor(person.id);
    await admin.assignRole(db(ownerCtx), ownerCtx, person.id, { roleKey: 'LIBRARIAN' });
    const fresh = (await check.revalidateToken(token, T0 + 60_000))!;
    expect(fresh.permVersion).toBeGreaterThan(token.permVersion);
    expect([...fresh.roles!].sort()).toEqual(['LIBRARIAN', 'TEACHER']);
  });

  it('a role taken away drops out of the token within the minute', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER', 'LIBRARIAN'], 'taken');
    const token = await tokenFor(person.id);
    const row = await prisma.userRole.findFirstOrThrow({ where: { userId: person.id, role: { key: 'LIBRARIAN' } } });
    await admin.removeRole(db(ownerCtx), ownerCtx, person.id, row.id);
    const fresh = (await check.revalidateToken(token, T0 + 60_000))!;
    expect(fresh.roles).toEqual(['TEACHER']);
    expect(fresh.permVersion).toBeGreaterThan(token.permVersion);
  });

  it('editing the grants of a custom role moves permVersion for everyone who holds it, and for nobody else', async () => {
    const role = await seeUsersRole();
    const holder = await userWithRoles(prisma, A, [role.key], 'holder');
    const other = await userWithRoles(prisma, A, ['TEACHER'], 'other');
    const [h0, o0] = [await tokenFor(holder.id), await tokenFor(other.id)];
    await admin.saveCustomRole(db(ownerCtx), ownerCtx, role.key, { grants: [{ key: 'system.users.view', scope: 'SCHOOL' }, { key: 'system.users.export', scope: 'SCHOOL' }] });
    expect((await check.revalidateToken(h0, T0 + 60_000))!.permVersion).toBeGreaterThan(h0.permVersion);
    expect((await check.revalidateToken(o0, T0 + 60_000))!.permVersion).toBe(o0.permVersion);
  });

  it('an exception given, and one ended, each move permVersion', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'exception');
    const t0 = await tokenFor(person.id);
    const made = await admin.createOverride(db(ownerCtx), ownerCtx, person.id, { permissionKey: 'hr.leave.view_all', effect: 'GRANT', reason: 'Cover for leave', days: 3 });
    const t1 = (await check.revalidateToken(t0, T0 + 60_000))!;
    expect(t1.permVersion).toBeGreaterThan(t0.permVersion);
    await admin.revokeOverride(db(ownerCtx), ownerCtx, made.id);
    const t2 = (await check.revalidateToken(t1, T0 + 120_000))!;
    expect(t2.permVersion).toBeGreaterThan(t1.permVersion);
  });

  it('a deactivated person is signed out at the next check, and so is one whose sessions were all ended', async () => {
    const gone = await userWithRoles(prisma, A, ['TEACHER'], 'gone');
    const token = await tokenFor(gone.id);
    await prisma.user.update({ where: { id: gone.id }, data: { active: false } });
    expect(await check.revalidateToken(token, T0 + 59_000)).toBe(token); // not yet looked at
    expect(await check.revalidateToken(token, T0 + 60_000)).toBeNull();

    const loggedOut = await userWithRoles(prisma, A, ['TEACHER'], 'loggedout');
    const t2 = await tokenFor(loggedOut.id);
    await prisma.user.update({ where: { id: loggedOut.id }, data: { tokenVersion: { increment: 1 } } });
    expect(await check.revalidateToken(t2, T0 + 60_000)).toBeNull();
  });
});

describe('the server does not wait for the token', () => {
  it('a permission removed stops working on the very next request, with the old token still valid', async () => {
    const role = await seeUsersRole();
    const person = await userWithRoles(prisma, A, [role.key], 'immediate');
    expect((await call('system/users', 'GET', { as: person })).status).toBe(200);
    const row = await prisma.userRole.findFirstOrThrow({ where: { userId: person.id, roleId: role.id } });
    await admin.removeRole(db(ownerCtx), ownerCtx, person.id, row.id);
    // The same session, the same token: the next request is already refused.
    expect((await call('system/users', 'GET', { as: person })).status).toBe(403);
  });

  it('a permission given works on the very next request', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'immediate2');
    expect((await call('system/users', 'GET', { as: person })).status).toBe(403);
    await admin.createOverride(db(ownerCtx), ownerCtx, person.id, { permissionKey: 'system.users.view', effect: 'GRANT', reason: 'Checking the user list', days: 1 });
    expect((await call('system/users', 'GET', { as: person })).status).toBe(200);
  });

  it('an exception that runs out stops working with no change to permVersion at all', async () => {
    const person = await userWithRoles(prisma, A, ['TEACHER'], 'expires');
    const past = new Date(Date.now() - 2 * 86_400_000);
    await prisma.userPermissionOverride.create({
      data: { schoolId: A.schoolId, userId: person.id, permissionKey: 'system.users.view', effect: 'GRANT', reason: 'Short cover', createdAt: past, expiresAt: new Date(Date.now() + 60_000), createdById: A.users.DIRECTOR.id },
    });
    const before = (await rowOf(person.id)).permVersion;
    expect((await call('system/users', 'GET', { as: person })).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5 * 60_000); // the exception ran out
    try {
      expect((await call('system/users', 'GET', { as: person })).status).toBe(403);
    } finally {
      vi.useRealTimers();
    }
    expect((await rowOf(person.id)).permVersion).toBe(before);
  });

  it('a deactivated person is refused by the server even before the token is read again', async () => {
    const role = await seeUsersRole();
    const person = await userWithRoles(prisma, A, [role.key], 'deactivated');
    expect((await call('system/users', 'GET', { as: person })).status).toBe(200);
    await prisma.user.update({ where: { id: person.id }, data: { active: false } });
    expect((await call('system/users', 'GET', { as: person })).status).toBe(401);
  });
});
