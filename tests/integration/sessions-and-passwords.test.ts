// @vitest-environment node
// Sessions that respect deactivation and role changes; password rules; sign-in lockout.
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  auth: (await import('../helpers/session')).mockAuth,
}));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const version = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).tokenVersion;

describe('session revalidation (JWT re-checked against the database every minute)', () => {
  let revalidateToken: typeof import('@/lib/session-check').revalidateToken;
  beforeAll(async () => {
    ({ revalidateToken } = await import('@/lib/session-check'));
  });

  const tokenFor = (u: { id: string; schoolId: string; role: string; fullName: string }, checkedAt: number, tokenVersion = 0) => ({
    id: u.id, schoolId: u.schoolId, role: u.role as never, fullName: u.fullName, tokenVersion, mustChangePassword: false, checkedAt,
  });

  it('trusts a token checked less than a minute ago without touching the database', async () => {
    const u = A.users.LIBRARIAN;
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    const now = Date.now();
    expect(await revalidateToken(tokenFor(u, now - 30_000), now)).not.toBeNull();
    expect(await revalidateToken(tokenFor(u, now - 61_000), now)).toBeNull(); // a minute on, the database is read and the deactivated user is out
    await prisma.user.update({ where: { id: u.id }, data: { active: true } });
  });

  it('ends the session of a user deactivated since the last check', async () => {
    const u = A.users.LIBRARIAN;
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    const now = Date.now();
    expect(await revalidateToken(tokenFor(u, now - 6 * 60_000), now)).toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { active: true } });
  });

  it('ends the session when tokenVersion has moved on', async () => {
    const u = A.users.BURSAR;
    await prisma.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } });
    const now = Date.now();
    expect(await revalidateToken(tokenFor(u, now - 6 * 60_000, 0), now)).toBeNull();
  });

  it('ends the session of a user who no longer exists', async () => {
    const now = Date.now();
    expect(await revalidateToken(tokenFor({ id: 'ghost', schoolId: A.schoolId, role: 'HEAD', fullName: 'x' }, now - 6 * 60_000), now)).toBeNull();
  });

  it('keeps a valid session, refreshes the role and moves the check time forward', async () => {
    const u = A.users.TEACHER;
    const v = await version(u.id);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'HEAD' } }); // changed without bumping (e.g. by a script)
    const now = Date.now();
    const kept = await revalidateToken(tokenFor(u, now - 6 * 60_000, v), now);
    expect(kept?.role).toBe('HEAD');
    expect(kept?.checkedAt).toBe(now);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'TEACHER' } });
  });

  it('carries the roles and permVersion, and rebuilds the roles when the person access changed, without signing out', async () => {
    const u = A.users.BURSAR;
    const now = Date.now();
    const before = await revalidateToken({ ...tokenFor(u, now - 61_000, await version(u.id)), roles: ['TEACHER'], permVersion: -1 }, now);
    expect(before?.roles).toEqual(['BURSAR']);
    const v0 = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).permVersion;
    expect(before?.permVersion).toBe(v0);
    const head = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'HEAD' } });
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: u.id, roleId: head.id } });
    await prisma.user.update({ where: { id: u.id }, data: { permVersion: { increment: 1 } } });
    const after = await revalidateToken({ ...tokenFor(u, now - 61_000, await version(u.id)), roles: before?.roles, permVersion: v0 }, now);
    expect(after?.roles?.slice().sort()).toEqual(['BURSAR', 'HEAD']);
    expect(after?.permVersion).toBe(v0 + 1);
    // Inside the minute the token is trusted as it is.
    const same = await revalidateToken({ ...tokenFor(u, now - 5_000, await version(u.id)), roles: ['BURSAR'], permVersion: v0 }, now);
    expect(same?.roles).toEqual(['BURSAR']);
    await prisma.userRole.deleteMany({ where: { userId: u.id, roleId: head.id } });
  });
});

describe('user management ends sessions', () => {
  it('deactivating bumps tokenVersion; reactivating does not', async () => {
    const target = await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Temp Staff', email: 'temp@schoola.test', role: 'TEACHER', passwordHash: 'x' },
    });
    const v0 = target.tokenVersion;
    const off = await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: target.id }, body: { active: false } });
    expect(off.status).toBe(200);
    expect(await version(target.id)).toBe(v0 + 1);
    await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: target.id }, body: { active: true } });
    expect(await version(target.id)).toBe(v0 + 1);
  });

  it('changing the role bumps tokenVersion; sending the same role does not', async () => {
    const target = await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Role Staff', email: 'role@schoola.test', role: 'TEACHER', passwordHash: 'x' },
    });
    const same = await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: target.id }, body: { role: 'TEACHER' } });
    expect(same.status).toBe(200);
    expect(await version(target.id)).toBe(0);
    const changed = await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: target.id }, body: { role: 'BURSAR' } });
    expect(changed.status).toBe(200);
    expect(await version(target.id)).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe('BURSAR');
  });

  it('an admin cannot deactivate themselves or change their own role', async () => {
    const off = await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: A.users.ADMIN.id }, body: { active: false } });
    expect(off.status).toBe(409);
    const role = await call('admin/users/[id]', 'PATCH', { as: A.users.ADMIN, params: { id: A.users.ADMIN.id }, body: { role: 'TEACHER' } });
    expect(role.status).toBe(409);
  });

  it('resetting a password bumps tokenVersion, forces a change and uses cost 12 with 10+ characters', async () => {
    const target = A.users.LIBRARIAN;
    const v0 = await version(target.id);
    const r = await call('admin/users/[id]/reset-password', 'POST', { as: A.users.ADMIN, params: { id: target.id } });
    expect(r.status).toBe(200);
    const temp: string = r.json.data.tempPassword;
    expect(temp.length).toBeGreaterThanOrEqual(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.tokenVersion).toBe(v0 + 1);
    expect(row.mustChangePassword).toBe(true);
    expect(bcrypt.getRounds(row.passwordHash)).toBe(12);
    expect(await bcrypt.compare(temp, row.passwordHash)).toBe(true);
  });

  it('a new account gets a temporary password, must change it, and is hashed at cost 12', async () => {
    const r = await call('admin/users', 'POST', { as: A.users.ADMIN, body: { fullName: 'New Person', email: 'new@schoola.test', role: 'TEACHER' } });
    expect(r.status).toBe(201);
    const row = await prisma.user.findFirstOrThrow({ where: { email: 'new@schoola.test' } });
    expect(row.mustChangePassword).toBe(true);
    expect(bcrypt.getRounds(row.passwordHash)).toBe(12);
    expect(r.json.data.tempPassword.length).toBeGreaterThanOrEqual(10);
  });

  it('"log out all sessions" signs everyone else out but not the admin, and is audited', async () => {
    const before = Object.fromEntries(await Promise.all(
      Object.values(A.users).map(async (u) => [u.id, await version(u.id)] as const),
    ));
    const bBefore = await version(B.users.HEAD.id);
    const r = await call('admin/users/logout-all', 'POST', { as: A.users.ADMIN });
    expect(r.status).toBe(200);
    for (const u of Object.values(A.users)) {
      const expected = u.id === A.users.ADMIN.id ? before[u.id] : before[u.id] + 1;
      expect(await version(u.id)).toBe(expected);
    }
    expect(await version(B.users.HEAD.id)).toBe(bBefore);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT_ALL_SESSIONS', schoolId: A.schoolId } })).toBeGreaterThan(0);
  });

  it('only user managers may use these actions', async () => {
    expect((await call('admin/users/logout-all', 'POST', { as: A.users.TEACHER })).status).toBe(403);
    expect((await call('admin/users/[id]/logout', 'POST', { as: A.users.BURSAR, params: { id: A.users.HEAD.id } })).status).toBe(403);
  });
});

describe('change password', () => {
  it('rejects a wrong current password, a short new password and re-using the old one', async () => {
    const u = A.users.HEAD;
    expect((await call('account/change-password', 'POST', { as: u, body: { currentPassword: 'nope-nope-nope', newPassword: 'a-long-new-password' } })).status).toBe(403);
    expect((await call('account/change-password', 'POST', { as: u, body: { currentPassword: 'Correct-horse-1', newPassword: 'short' } })).status).toBe(422);
    expect((await call('account/change-password', 'POST', { as: u, body: { currentPassword: 'Correct-horse-1', newPassword: 'Correct-horse-1' } })).status).toBe(422);
  });

  it('changes the password, clears the forced-change flag, ends all sessions and is audited', async () => {
    const u = A.users.DIRECTOR;
    await prisma.user.update({ where: { id: u.id }, data: { mustChangePassword: true } });
    const v0 = await version(u.id);
    const r = await call('account/change-password', 'POST', { as: u, body: { currentPassword: 'Correct-horse-1', newPassword: 'My-new-strong-pass' } });
    expect(r.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mustChangePassword).toBe(false);
    expect(row.tokenVersion).toBe(v0 + 1);
    expect(row.passwordChangedAt).not.toBeNull();
    expect(bcrypt.getRounds(row.passwordHash)).toBe(12);
    expect(await bcrypt.compare('My-new-strong-pass', row.passwordHash)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'CHANGE_PASSWORD', entityId: u.id } })).toBe(1);
  });

  it('requires a signed-in user', async () => {
    expect((await call('account/change-password', 'POST', { as: null, body: { currentPassword: 'x', newPassword: 'y' } })).status).toBe(401);
  });
});

describe('sign-in', () => {
  let authorizeCredentials: typeof import('@/lib/auth').authorizeCredentials;
  let AccountLockedError: typeof import('@/lib/auth').AccountLockedError;
  let resetLimits: () => void;

  beforeAll(async () => {
    ({ authorizeCredentials, AccountLockedError } = await import('@/lib/auth'));
    resetLimits = (await import('@/lib/rate-limit'))._resetRateLimitForTests;
  });
  beforeEach(() => resetLimits());

  const req = (ip: string) => new Request('http://localhost/api/auth/callback/credentials', { headers: { 'x-forwarded-for': ip } });
  const email = () => A.users.TEACHER.email;

  it('signs in with the right password (email case does not matter) and returns what goes into the JWT', async () => {
    const u = await authorizeCredentials({ email: email().toUpperCase(), password: 'Correct-horse-1' }, req('1.1.1.1'));
    expect(u).toMatchObject({ id: A.users.TEACHER.id, schoolId: A.schoolId, role: 'TEACHER', tokenVersion: expect.any(Number), mustChangePassword: false });
  });

  it('refuses a wrong password, an unknown email and an inactive user', async () => {
    expect(await authorizeCredentials({ email: email(), password: 'wrong-wrong-1' }, req('1.1.1.2'))).toBeNull();
    expect(await authorizeCredentials({ email: 'nobody@nowhere.test', password: 'Correct-horse-1' }, req('1.1.1.2'))).toBeNull();
    const off = await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Gone', email: 'gone@schoola.test', role: 'TEACHER', passwordHash: await bcrypt.hash('Correct-horse-1', 4), active: false },
    });
    expect(await authorizeCredentials({ email: off.email, password: 'Correct-horse-1' }, req('1.1.1.2'))).toBeNull();
  });

  it('locks an email + IP for 15 minutes after 5 failures, even for the right password; another IP is unaffected', async () => {
    const ip = '2.2.2.2';
    for (let i = 0; i < 4; i++) expect(await authorizeCredentials({ email: email(), password: 'bad-bad-bad-1' }, req(ip))).toBeNull();
    await expect(authorizeCredentials({ email: email(), password: 'bad-bad-bad-1' }, req(ip))).rejects.toBeInstanceOf(AccountLockedError);
    await expect(authorizeCredentials({ email: email(), password: 'Correct-horse-1' }, req(ip))).rejects.toBeInstanceOf(AccountLockedError);
    expect(await authorizeCredentials({ email: email(), password: 'Correct-horse-1' }, req('3.3.3.3'))).not.toBeNull();
  });

  it('lets the lock expire after 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const ip = '4.4.4.4';
      for (let i = 0; i < 5; i++) await authorizeCredentials({ email: email(), password: 'bad-bad-bad-1' }, req(ip)).catch(() => null);
      await expect(authorizeCredentials({ email: email(), password: 'Correct-horse-1' }, req(ip))).rejects.toBeInstanceOf(AccountLockedError);
      vi.setSystemTime(Date.now() + 15 * 60_000 + 1000);
      expect(await authorizeCredentials({ email: email(), password: 'Correct-horse-1' }, req(ip))).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a successful sign-in clears earlier failures', async () => {
    const ip = '5.5.5.5';
    for (let i = 0; i < 4; i++) await authorizeCredentials({ email: email(), password: 'bad-bad-bad-1' }, req(ip));
    expect(await authorizeCredentials({ email: email(), password: 'Correct-horse-1' }, req(ip))).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(await authorizeCredentials({ email: email(), password: 'bad-bad-bad-1' }, req(ip))).toBeNull();
  });

  it('writes repeated failures and the lock to the AuditLog', async () => {
    const ip = '6.6.6.6';
    const who = A.users.LIBRARIAN;
    for (let i = 0; i < 5; i++) await authorizeCredentials({ email: who.email, password: 'bad-bad-bad-1' }, req(ip)).catch(() => null);
    const rows = await prisma.auditLog.findMany({ where: { entityId: who.id, action: { in: ['LOGIN_FAILED', 'LOGIN_LOCKED'] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_FAILED', 'LOGIN_LOCKED']); // every failure, then the locking 5th
    expect(rows.every((r) => r.ip === '6.6.6.6' && r.module === 'system')).toBe(true);
    expect(rows[0].detail).toMatch(/6\.6\.6\.6/);
    expect(rows.every((r) => r.schoolId === A.schoolId)).toBe(true);
  });

  it('picks the right school when the same email exists in two schools', async () => {
    const shared = 'shared@both.test';
    const hashA = await bcrypt.hash('Password-for-A-1', 4);
    const hashB = await bcrypt.hash('Password-for-B-1', 4);
    await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Shared A', email: shared, role: 'TEACHER', passwordHash: hashA } });
    await prisma.user.create({ data: { schoolId: B.schoolId, fullName: 'Shared B', email: shared, role: 'TEACHER', passwordHash: hashB } });
    expect((await authorizeCredentials({ email: shared, password: 'Password-for-A-1' }, req('7.7.7.7')))?.schoolId).toBe(A.schoolId);
    expect((await authorizeCredentials({ email: shared, password: 'Password-for-B-1' }, req('7.7.7.7')))?.schoolId).toBe(B.schoolId);
  });

  it('upgrades an old cost-10 hash to cost 12 at sign-in', async () => {
    const u = await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Old Hash', email: 'oldhash@schoola.test', role: 'TEACHER', passwordHash: await bcrypt.hash('Old-hash-pass-1', 10) },
    });
    expect(await authorizeCredentials({ email: u.email, password: 'Old-hash-pass-1' }, req('8.8.8.8'))).not.toBeNull();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(bcrypt.getRounds(row.passwordHash)).toBe(12);
    expect(await bcrypt.compare('Old-hash-pass-1', row.passwordHash)).toBe(true);
  });

  it('carries mustChangePassword and tokenVersion into the token', async () => {
    const u = await prisma.user.create({
      data: { schoolId: A.schoolId, fullName: 'Forced', email: 'forced@schoola.test', role: 'TEACHER', passwordHash: await bcrypt.hash('Temp-password-1', 4), mustChangePassword: true, tokenVersion: 3 },
    });
    expect(await authorizeCredentials({ email: u.email, password: 'Temp-password-1' }, req('9.9.9.9'))).toMatchObject({ mustChangePassword: true, tokenVersion: 3 });
  });
});

describe('session lifetime', () => {
  it('JWTs last 8 hours', async () => {
    const { authConfig, SESSION_MAX_AGE_SECONDS } = await import('@/lib/auth.config');
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * 60 * 60);
    expect(authConfig.session).toEqual({ strategy: 'jwt', maxAge: 8 * 60 * 60 });
  });
});
