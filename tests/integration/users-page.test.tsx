// @vitest-environment node
// The Users page: several roles, invites and temporary passwords, the list, and import from a file.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, revokePermission, seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  auth: (await import('../helpers/session')).mockAuth,
}));

// Hashing passwords (bcrypt cost 12) makes several of these take a few seconds; give them room when the machine is busy.
vi.setConfig({ testTimeout: 30_000 });

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const admin = () => A.users.ADMIN;
// Only the Owner gives the Owner, Head, Bursar and Administrator roles, so adding people is done as the Owner unless a test says otherwise.
const owner = () => A.users.DIRECTOR;
const post = (body: object, as: object | null = owner()) => call('system/users', 'POST', { as: as as never, body });
const person = (over: object = {}) => ({ fullName: 'Rudo Chari', email: 'rudo@a.test', phone: '0771234567', roles: ['TEACHER'], ...over });
const tokenOf = (url: string) => /reset-password\/([A-Za-z0-9_-]+)/.exec(url)![1];
const csv = (...lines: string[]) => lines.join('\n');
const rolesOf = async (userId: string) => (await prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } })).map((x) => x.role.key).sort();
const auditCount = (where: object = {}) => prisma.auditLog.count({ where: { schoolId: A.schoolId, ...where } });

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NEXTAUTH_URL = 'https://pfuma.test';
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('adding a person with an invite', () => {
  let created: { id: string; url: string };

  it('creates the account with several roles, a +263 phone and a tidy name, and returns the link once', async () => {
    const r = await post(person({ fullName: '  tendai   MOYO ', email: 'Tendai.Moyo@A.test', phone: '+263 77 123 4567', roles: ['TEACHER', 'CLASS_TEACHER', 'BURSAR', 'TEACHER'], title: 'Mrs' }));
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { user, invite, tempPassword } = r.json.data;
    expect(tempPassword).toBeNull();
    expect(user).toMatchObject({ fullName: 'Tendai Moyo', email: 'tendai.moyo@a.test', phone: '+263771234567', title: 'Mrs', status: 'invited' });
    expect([...user.roles].sort()).toEqual(['BURSAR', 'CLASS_TEACHER', 'TEACHER']);
    expect(await rolesOf(user.id)).toEqual(['BURSAR', 'CLASS_TEACHER', 'TEACHER']);
    expect(invite.url).toMatch(/^https:\/\/pfuma\.test\/reset-password\/[A-Za-z0-9_-]{40,}\?invite=1$/);
    expect(JSON.stringify(r.json)).not.toMatch(/passwordHash/);
    created = { id: user.id, url: invite.url };

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ schoolId: A.schoolId, role: 'BURSAR', invitePending: true, mustChangePassword: false, active: true });
    expect(row.passwordHash.startsWith('!invited!')).toBe(true);        // nobody knows it
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored).toMatchObject({ kind: 'INVITE', usedAt: null });
    expect(stored.tokenHash).not.toContain(tokenOf(invite.url));          // only a hash is kept
    const hours = (stored.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
  });

  it('logs who added whom and the invite, with no secrets in the log', async () => {
    expect(await auditCount({ action: 'CREATE_USER', entityId: created.id })).toBe(1);
    expect(await auditCount({ action: 'INVITE_USER', entityId: created.id })).toBe(1);
    const logs = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityId: created.id } });
    const text = JSON.stringify(logs);
    expect(text).not.toContain(tokenOf(created.url));
    expect(text).not.toMatch(/passwordHash|invited!/);
    expect(await prisma.notification.count({ where: { userId: A.users.ADMIN.id, title: 'User added' } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: owner().id, title: 'User added' } })).toBe(0);
  });

  it('cannot be signed into before the invite is used', async () => {
    const { authorizeCredentials } = await import('@/lib/auth');
    for (const pw of ['', 'password', '!invited!', 'Correct-horse-1']) {
      expect(await authorizeCredentials({ email: 'tendai.moyo@a.test', password: pw }), pw).toBeNull();
    }
  });

  it('lets the person choose a password with the link, once, and then they are active', async () => {
    const use = (token: string, newPassword: string) => call('password-reset', 'POST', { body: { token, newPassword } });
    expect((await use(tokenOf(created.url), 'short')).status).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).invitePending).toBe(true);

    const ok = await use(tokenOf(created.url), 'My-own-password-9');
    expect(ok.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ invitePending: false, mustChangePassword: false });
    expect(row.passwordChangedAt).not.toBeNull();
    expect(await auditCount({ action: 'ACCEPT_INVITE', entityId: created.id })).toBe(1);

    const { authorizeCredentials } = await import('@/lib/auth');
    expect((await authorizeCredentials({ email: 'tendai.moyo@a.test', password: 'My-own-password-9' }))?.id).toBe(created.id);
    expect((await use(tokenOf(created.url), 'Another-password-9')).status).toBe(410); // single use
    const list = await call('system/users', 'GET', { as: admin(), query: '?q=tendai' });
    expect(list.json.data.users[0].status).toBe('active');
  });

  it('stops working after 72 hours, and for a deactivated person', async () => {
    const a = await post(person({ email: 'late@a.test' }));
    await prisma.passwordResetToken.updateMany({ where: { userId: a.json.data.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await call('password-reset', 'POST', { body: { token: tokenOf(a.json.data.invite.url), newPassword: 'My-own-password-9' } });
    expect(late.status).toBe(410);

    const b = await post(person({ email: 'gone@a.test' }));
    await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: b.json.data.user.id } });
    const gone = await call('password-reset', 'POST', { body: { token: tokenOf(b.json.data.invite.url), newPassword: 'My-own-password-9' } });
    expect(gone.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.json.data.user.id } })).passwordHash.startsWith('!invited!')).toBe(true);
  });

  it('can be sent again: a new link replaces the old one, only while invited', async () => {
    const a = await post(person({ email: 'again@a.test' }));
    const id = a.json.data.user.id;
    const second = await call('system/users/[id]/invite', 'POST', { as: admin(), params: { id } });
    expect(second.status).toBe(200);
    expect(second.json.data.invite.url).not.toBe(a.json.data.invite.url);
    expect((await call('password-reset', 'POST', { body: { token: tokenOf(a.json.data.invite.url), newPassword: 'My-own-password-9' } })).status).toBe(410); // the first no longer works
    expect((await call('password-reset', 'POST', { body: { token: tokenOf(second.json.data.invite.url), newPassword: 'My-own-password-9' } })).status).toBe(200);
    expect((await call('system/users/[id]/invite', 'POST', { as: admin(), params: { id } })).status).toBe(409);  // already set up
    expect((await call('system/users/[id]/invite', 'POST', { as: admin(), params: { id: B.users.TEACHER.id } })).status).toBe(404);
    expect((await call('system/users/[id]/invite', 'POST', { as: A.users.HEAD, params: { id } })).status).toBe(403);
    expect(await auditCount({ action: 'INVITE_USER', entityId: id })).toBe(2);
  });
});

describe('adding a person with a temporary password', () => {
  it('makes a password shown once; the person must change it', async () => {
    const r = await post(person({ email: 'temp@a.test', signIn: 'TEMP_PASSWORD' }));
    expect(r.status).toBe(201);
    expect(r.json.data.invite).toBeNull();
    const pw: string = r.json.data.tempPassword;
    expect(pw.length).toBeGreaterThanOrEqual(10);
    const id = r.json.data.user.id;
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ mustChangePassword: true, invitePending: true });
    expect(row.passwordHash).not.toContain(pw);
    expect(await prisma.passwordResetToken.count({ where: { userId: id } })).toBe(0);
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: id } }))).not.toContain(pw);

    const { authorizeCredentials } = await import('@/lib/auth');
    const signedIn = await authorizeCredentials({ email: 'temp@a.test', password: pw });
    expect(signedIn).toMatchObject({ id, mustChangePassword: true });
    expect((await call('system/users', 'GET', { as: admin(), query: '?q=temp@a.test' })).json.data.users[0].status).toBe('invited');

    session.current = { id, email: 'temp@a.test', schoolId: A.schoolId, role: 'TEACHER', fullName: 'Rudo Chari' };
    const changed = await call('account/change-password', 'POST', { as: { id, email: 'temp@a.test', schoolId: A.schoolId, role: 'TEACHER', fullName: 'Rudo Chari' } as never, body: { currentPassword: pw, newPassword: 'Brand-new-password-7' } });
    expect(changed.status, JSON.stringify(changed.json)).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ mustChangePassword: false, invitePending: false });
    expect((await call('system/users', 'GET', { as: admin(), query: '?q=temp@a.test' })).json.data.users[0].status).toBe('active');
  });

  it('sends a reset link by default: 30 minutes, one use, and the old password keeps working until it is used', async () => {
    const r = await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id: A.users.TEACHER.id } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.method).toBe('LINK');
    expect(r.json.data.tempPassword).toBeUndefined();
    const url: string = r.json.data.reset.url;
    expect(url).toMatch(/\/reset-password\/[A-Za-z0-9_-]{40,}$/);
    const minutes = (new Date(r.json.data.reset.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: A.users.TEACHER.id, usedAt: null }, orderBy: { createdAt: 'desc' } });
    expect(stored.kind).toBe('RESET');
    expect(stored.tokenHash).not.toContain(tokenOf(url));
    expect(await auditCount({ action: 'CREATE_PASSWORD_RESET', entityId: A.users.TEACHER.id })).toBeGreaterThan(0);
    const bad = await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id: B.users.TEACHER.id } });
    expect(bad.status).toBe(404);
  });

  it('can still make a temporary password for any active person', async () => {
    const r = await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id: A.users.TEACHER.id }, body: { method: 'TEMP_PASSWORD' } });
    expect(r.status).toBe(200);
    expect(r.json.data.tempPassword.length).toBeGreaterThanOrEqual(10);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: A.users.TEACHER.id } })).mustChangePassword).toBe(true);
  });
});

describe('what is checked when adding a person', () => {
  it('refuses bad input and saves nothing', async () => {
    const n = await prisma.user.count({ where: { schoolId: A.schoolId } });
    const bad: object[] = [
      { fullName: 'R' }, { fullName: 'x'.repeat(81) }, { fullName: '' },
      { email: 'nope' }, { email: '' },
      { phone: '' }, { phone: 'call me' }, { phone: '0242700123' }, { phone: '+27 82 123 4567' }, { phone: '077123456' },
      { roles: [] }, { roles: ['GOD'] }, { roles: 'TEACHER' }, { roles: undefined },
      { title: 'Prof' }, { signIn: 'EMAIL_ME' },
    ];
    for (const b of bad) expect((await post(person({ email: 'bad@a.test', ...b }))).status, JSON.stringify(b)).toBe(422);
    expect((await call('system/users', 'POST', { as: admin(), rawBody: '{nope' })).status).toBe(400);
    expect(await prisma.user.count({ where: { schoolId: A.schoolId } })).toBe(n);
  });

  it('accepts every role and every way of writing a mobile number', async () => {
    const roles = ['OWNER', 'HEAD', 'DEPUTY_HEAD', 'ADMINISTRATOR', 'BURSAR', 'ACCOUNTS_CLERK', 'HR_OFFICER', 'HOD', 'TEACHER', 'CLASS_TEACHER', 'EXAMS_OFFICER', 'LIBRARIAN', 'BOARDING_MASTER'];
    expect(roles).toHaveLength(13);
    const r = await post(person({ email: 'all@a.test', roles }));
    expect(r.status).toBe(201);
    expect(r.json.data.user.roles).toHaveLength(13);
    const phones = ['0771234567', '+263771234567', '263771234567', '0263 77 123 4567'.replace('0263', '+263'), '077-123-4567', '0731234567', '0781234567', '0711234567'];
    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];
      const x = await post(person({ email: `ph${i}@a.test`, phone }));
      expect(x.status, phone).toBe(201);
      expect(x.json.data.user.phone, phone).toMatch(/^\+263(71|73|77|78)\d{7}$/);
    }
  });

  it('keeps emails unique inside a school, ignoring capitals, but not across schools', async () => {
    expect((await post(person({ email: 'dup@a.test' }))).status).toBe(201);
    expect((await post(person({ email: 'DUP@A.test' }))).status).toBe(409);
    expect((await post(person({ email: 'dup@a.test' }), B.users.ADMIN)).status).toBe(201);
    expect((await prisma.user.findFirstOrThrow({ where: { email: 'dup@a.test', schoolId: B.schoolId } })).schoolId).toBe(B.schoolId);
  });

  it('is for people who may add users, and signed in', async () => {
    for (const role of ['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const) expect((await post(person({ email: `no-${role}@a.test` }), A.users[role])).status, role).toBe(403);
    expect((await post(person({ email: 'anon@a.test' }), null)).status).toBe(401);
  });
});

describe('changing a person', () => {
  it('updates name, email, phone, title and roles; roles change the access level and end open sessions', async () => {
    const made = await post(person({ email: 'edit@a.test', roles: ['TEACHER'] }));
    const id = made.json.data.user.id;
    const v = (await prisma.user.findUniqueOrThrow({ where: { id } })).tokenVersion;
    const r = await call('system/users/[id]', 'PATCH', { as: owner(), params: { id }, body: { fullName: 'rudo MOYO-chari', phone: '0712345678', title: 'Dr', roles: ['HEAD', 'TEACHER'] } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ fullName: 'Rudo Moyo-Chari', phone: '+263712345678', title: 'Dr', role: 'HEAD' });
    expect(await rolesOf(id)).toEqual(['HEAD', 'TEACHER']);
    expect(row.tokenVersion).toBe(v + 1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ROLES_CHANGED', entityId: id }, orderBy: { createdAt: 'desc' } });
    expect(entry.detail).toBe('Rudo Moyo-Chari: Teacher → Head, Teacher');
    expect(entry.module).toBe('system');
    expect(await prisma.notification.count({ where: { userId: id, type: 'ROLES_CHANGED' } })).toBe(1);
    expect(entry.before).toMatchObject({ roles: ['TEACHER'] });
    // title cleared with a blank, and details-only changes do not touch sessions
    const r2 = await call('system/users/[id]', 'PATCH', { as: admin(), params: { id }, body: { title: '' } });
    expect(r2.json.data.user.title).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).tokenVersion).toBe(v + 1);
  });

  it('refuses a clashing email, an empty change, bad values, your own roles and another school\'s people', async () => {
    const id = (await prisma.user.findFirstOrThrow({ where: { email: 'edit@a.test' } })).id;
    const patch = (body: object, who: string = id, as: object | null = admin()) => call('system/users/[id]', 'PATCH', { as: as as never, params: { id: who }, body });
    expect((await patch({ email: A.users.HEAD.email })).status).toBe(409);
    expect((await patch({})).status).toBe(422);
    for (const b of [{ roles: [] }, { roles: ['NOPE'] }, { phone: '12345' }, { fullName: 'x' }, { title: 'Prof' }]) expect((await patch(b)).status, JSON.stringify(b)).toBe(422);
    expect((await patch({ roles: ['TEACHER'] }, admin().id)).status).toBe(403); // rule 8: nobody changes their own roles
    expect((await patch({ fullName: 'Taken Over' }, B.users.TEACHER.id)).status).toBe(404);
  });

  it('keeps at least one active Owner and one active Administrator when roles change', async () => {
    // Earlier tests made others; only the seeded Administrator and Owner should hold these two roles.
    await prisma.userRole.deleteMany({ where: { schoolId: A.schoolId, role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } }, userId: { notIn: [admin().id, A.users.DIRECTOR.id] } } });
    // Only an Owner changes the Owner and Administrator roles, and nobody changes their own, so a second Owner does the changing.
    await grantPermission(prisma, A.schoolId, 'HEAD', 'system.users.deactivate');
    // The seeded Head stands in as the second Owner for this test (no new person, so the list tests below are unaffected).
    const second = A.users.HEAD;
    const headRows = await prisma.userRole.findMany({ where: { userId: second.id } });
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: second.id, roleId: (await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'OWNER' } })).id } });
    try {
      const patch = (as: object, id: string, roles: string[]) => call('system/users/[id]', 'PATCH', { as: as as never, params: { id }, body: { roles } });
      const lastAdmin = await patch(owner(), admin().id, ['TEACHER']);
      expect(lastAdmin.status).toBe(409);
      expect(lastAdmin.json.message).toMatch(/at least one active Administrator/);
      expect((await patch(A.users.TEACHER, admin().id, ['TEACHER'])).status).toBe(403);            // not for just anyone
      expect((await patch(second, A.users.DIRECTOR.id, ['TEACHER'])).status).toBe(200);            // the second Owner remains
      expect((await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: second.id } })).status).toBe(409);   // now the last one
      expect(await rolesOf(admin().id)).toContain('ADMINISTRATOR');
      expect((await patch(second, A.users.DIRECTOR.id, ['OWNER', 'ADMINISTRATOR'])).status).toBe(200); // adding a role is fine
      expect((await patch(second, admin().id, ['TEACHER'])).status).toBe(200);                     // now another Administrator exists
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: { in: [admin().id, A.users.DIRECTOR.id, second.id] } } });
      await prisma.userRole.createMany({ data: headRows.map(({ id, schoolId, userId, roleId, scopeType, scopeId }) => ({ id, schoolId, userId, roleId, scopeType, scopeId })) });
      const roleId = async (key: string) => (await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key } })).id;
      await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: admin().id, roleId: await roleId('ADMINISTRATOR') } });
      await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: A.users.DIRECTOR.id, roleId: await roleId('OWNER') } });
      await revokePermission(prisma, A.schoolId, 'HEAD', 'system.users.deactivate');
    }
  });

  it('never lets an Administrator deactivate themselves', async () => {
    const r = await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: admin().id } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/your own account/);
  });
});

describe('the list', () => {
  const list = async (query = '', as = admin()) => (await call('system/users', 'GET', { as, query })).json.data;

  it('shows name, email, phone, roles, status, last login and joined, with counts for the whole school', async () => {
    await prisma.user.update({ where: { id: A.users.HEAD.id }, data: { lastLoginAt: new Date('2026-09-01T08:00:00Z') } });
    const d = await list('?pageSize=100');
    const head = d.users.find((u: { id: string }) => u.id === A.users.HEAD.id);
    expect(head).toMatchObject({ fullName: A.users.HEAD.fullName, email: A.users.HEAD.email, roles: ['HEAD'], status: 'active', lastLoginAt: '2026-09-01T08:00:00.000Z' });
    expect(head.createdAt).toBeTruthy();
    const all = await prisma.user.findMany({ where: { schoolId: A.schoolId } });
    expect(d.counts).toEqual({
      active: all.filter((u) => u.active && !u.invitePending).length,
      invited: all.filter((u) => u.active && u.invitePending).length,
      deactivated: all.filter((u) => !u.active).length,
    });
    expect(d.counts.invited).toBeGreaterThan(0);
    expect(d.counts.deactivated).toBeGreaterThan(0);
    expect(d.users.every((u: { email: string }) => !u.email.includes('school2'))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/passwordHash/);
    // counts do not change with the filter
    expect((await list('?status=invited&pageSize=100')).counts).toEqual(d.counts);
  });

  it('searches by name, email or phone, in any way of writing the number', async () => {
    const ph = await post(person({ email: 'searchme@a.test', fullName: 'Zanele Phiri', phone: '0782223344' }));
    expect(ph.status).toBe(201);
    for (const q of ['zanele', 'PHIRI', 'searchme', '0782223344', '+263782223344', '782223', '78 222 3344']) {
      const d = await list(`?q=${encodeURIComponent(q)}`);
      expect(d.users.map((u: { email: string }) => u.email), q).toContain('searchme@a.test');
    }
    expect((await list('?q=nobodyhasthisname')).total).toBe(0);
  });

  it('filters by role (anyone who holds it) and by status', async () => {
    const teachers = await list('?role=TEACHER&pageSize=100');
    expect(teachers.users.length).toBeGreaterThan(1);
    expect(teachers.users.every((u: { roles: string[] }) => u.roles.includes('TEACHER'))).toBe(true);
    expect(teachers.users.some((u: { roles: string[] }) => u.roles.length > 1)).toBe(true); // multi-role people appear
    for (const status of ['invited', 'active', 'deactivated']) {
      const d = await list(`?status=${status}&pageSize=100`);
      expect(d.total, status).toBeGreaterThan(0);
      expect(d.users.every((u: { status: string }) => u.status === status), status).toBe(true);
    }
    expect((await list('?role=GOD&status=bogus')).total).toBeGreaterThan(5); // unknown filter values are ignored
  });

  it('sorts, with people who never signed in last, and pages', async () => {
    const asc = await list('?sort=lastLoginAt&dir=asc&pageSize=100');
    const desc = await list('?sort=lastLoginAt&dir=desc&pageSize=100');
    for (const d of [asc, desc]) {
      const seenNull = d.users.findIndex((u: { lastLoginAt: string | null }) => u.lastLoginAt === null);
      expect(d.users.slice(seenNull).every((u: { lastLoginAt: string | null }) => u.lastLoginAt === null)).toBe(true);
    }
    const names = (await list('?sort=fullName&dir=desc&pageSize=100')).users.map((u: { fullName: string }) => u.fullName);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
    const p1 = await list('?pageSize=10&page=1');
    const p2 = await list('?pageSize=10&page=2');
    expect(p1.users).toHaveLength(10);
    expect(p2.users[0].id).not.toBe(p1.users[0].id);
  });

  it('exports the same list as CSV, safe for spreadsheets, without secrets', async () => {
    await post(person({ email: 'csv@a.test', fullName: '=cmd Evil', roles: ['LIBRARIAN', 'EXAMS_OFFICER'] }));
    const r = await call('system/users', 'GET', { as: admin(), query: '?format=csv&q=csv@a.test' });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toContain('text/csv');
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Phone,Roles,Status,Last login,Joined');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("'=cmd Evil");
    expect(lines[1]).toContain('Exams Officer; Librarian');
    expect(lines[1]).toContain('Invited');
    expect(lines[1]).toContain('+263771234567');
    expect(r.text).not.toMatch(/password|invited!/i);
    expect((await call('system/users', 'GET', { as: A.users.HEAD, query: '?format=csv' })).status).toBe(403);
  });
});

describe('import from a file', () => {
  const imp = (text: string, as: object | null = owner()) => call('system/users/import', 'POST', { as: as as never, body: { csv: text } });
  const header = 'name,email,phone,roles';

  it('adds the good rows, reports the rejected ones with the reason, and returns an invite for each new person', async () => {
    const r = await imp(csv(
      header,
      'Tinashe Ncube,tinashe@a.test,0771110001,Teacher;Class Teacher',
      '"Moyo, Sarah",sarah@a.test,+263 712 220 002,"Bursar"',
      'Bad Email,not-an-email,0771110003,Teacher',
      'No Phone,nophone@a.test,,Teacher',
      'Foreign Phone,foreign@a.test,+27821234567,Teacher',
      'Unknown Role,unknown@a.test,0771110004,Wizard',
      'No Role,norole@a.test,0771110005,',
      'Repeat One,repeat@a.test,0771110006,Teacher',
      'Repeat Two,REPEAT@a.test,0771110007,Teacher',
      `Existing Person,${A.users.HEAD.email},0771110008,Teacher`,
      'x,short@a.test,0771110009,Teacher',
    ));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = r.json.data;
    expect(d.created).toBe(3); // Tinashe, Sarah, Repeat One
    expect(d.invites).toHaveLength(3);
    for (const i of d.invites) expect(i.url).toMatch(/\/reset-password\/.+\?invite=1$/);
    const why = Object.fromEntries(d.rejected.map((x: { row: number; reason: string }) => [x.row, x.reason]));
    expect(why[4]).toMatch(/valid email/i);
    expect(why[5]).toMatch(/Zimbabwe mobile/);
    expect(why[6]).toMatch(/Zimbabwe mobile/);
    expect(why[7]).toBe('Unknown role "Wizard"');
    expect(why[8]).toMatch(/at least one role/i);
    expect(why[10]).toMatch(/repeated \(first on row 9\)/);
    expect(why[11]).toMatch(/already used/);
    expect(why[12]).toMatch(/at least 2 characters/);
    expect(d.rejected.map((x: { row: number }) => x.row)).toEqual([4, 5, 6, 7, 8, 10, 11, 12]);
    expect(d.rejected[0]).toMatchObject({ name: 'Bad Email', email: 'not-an-email' });

    const t = await prisma.user.findFirstOrThrow({ where: { email: 'tinashe@a.test' } });
    expect(t).toMatchObject({ fullName: 'Tinashe Ncube', phone: '+263771110001', invitePending: true, role: 'TEACHER' });
    expect(await rolesOf(t.id)).toEqual(['CLASS_TEACHER', 'TEACHER']);
    expect((await prisma.user.findFirstOrThrow({ where: { email: 'sarah@a.test' } })).fullName).toBe('Moyo, Sarah');
    expect(await prisma.user.count({ where: { email: { in: ['nophone@a.test', 'unknown@a.test', 'short@a.test'] } } })).toBe(0);
    expect(await auditCount({ action: 'IMPORT_USERS' })).toBe(1);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'IMPORT_USERS' } })).detail).toBe('Imported 3 users from a file; 8 rows rejected');
    expect(await auditCount({ action: 'CREATE_USER', entityId: t.id })).toBe(1);
    // the link in the response really lets the person in
    const link = d.invites.find((i: { email: string }) => i.email === 'tinashe@a.test').url;
    expect((await call('password-reset', 'POST', { body: { token: tokenOf(link), newPassword: 'Imported-password-5' } })).status).toBe(200);
  });

  it('rejects everything on a second run of the same file, and adds nobody twice', async () => {
    const before = await prisma.user.count({ where: { schoolId: A.schoolId } });
    const r = await imp(csv(header, 'Tinashe Ncube,tinashe@a.test,0771110001,Teacher'));
    expect(r.json.data).toMatchObject({ created: 0, invites: [] });
    expect(r.json.data.rejected[0].reason).toMatch(/already used/);
    expect(await prisma.user.count({ where: { schoolId: A.schoolId } })).toBe(before);
  });

  it('understands other headings, a byte-order mark, quoted roles, and other ways of writing role names', async () => {
    const r = await imp(`﻿Full Name,E-mail,Mobile,Role\r\nAmai Dube,amai@a.test,0781234000,"head; DEPUTY_HEAD"\r\n`);
    expect(r.json.data.created).toBe(1);
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'amai@a.test' } });
    expect(await rolesOf(u.id)).toEqual(['DEPUTY_HEAD', 'HEAD']);
    expect(u.role).toBe('HEAD');
  });

  it('refuses a file with the wrong shape', async () => {
    expect((await imp('')).status).toBe(422);
    expect((await imp(header)).status).toBe(422);                                                  // no people
    const missing = await imp(csv('name,email', 'A B,ab@a.test'));
    expect(missing.status).toBe(422);
    expect(missing.json.message).toMatch(/missing: phone, roles/);
    const big = csv(header, ...Array.from({ length: 201 }, (_, i) => `P ${i},p${i}@bulk.test,0771000000,Teacher`));
    const tooMany = await imp(big);
    expect(tooMany.status).toBe(422);
    expect(tooMany.json.message).toMatch(/At most 200/);
    expect((await imp('x'.repeat(300_001))).status).toBe(422);
    expect(await prisma.user.count({ where: { email: { endsWith: '@bulk.test' } } })).toBe(0);
  });

  it('adds up to 200 people in one go', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Person ${i},p${i}@many.test,07712${String(i).padStart(5, '0')},Teacher`);
    const r = await imp(csv(header, ...rows));
    expect(r.json.data.created).toBe(200);
    expect(await prisma.user.count({ where: { email: { endsWith: '@many.test' } } })).toBe(200);
  }, 120_000);

  it('serves a template, and is for people who may import, in their own school', async () => {
    const tpl = await call('system/users/import', 'GET', { as: admin() });
    expect(tpl.status).toBe(200);
    expect(tpl.text).toContain('name,email,phone,roles');
    expect((await imp(csv(header, 'No Way,noway@a.test,0771234567,Teacher'), A.users.HEAD)).status).toBe(403);
    expect((await call('system/users/import', 'GET', { as: A.users.HEAD })).status).toBe(403);
    expect((await imp(csv(header, 'No Way,noway@a.test,0771234567,Teacher'), null)).status).toBe(401);
    expect(await prisma.user.count({ where: { schoolId: B.schoolId, email: { endsWith: '@many.test' } } })).toBe(0);
    // the same email can exist in another school
    const b = await imp(csv(header, 'Tinashe Ncube,tinashe@a.test,0771110001,Teacher'), B.users.ADMIN);
    expect(b.json.data.created).toBe(1);
  });
});

describe('older code that only knows one role', () => {
  it('still works: the user gets the role that matches the access level', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Legacy', email: 'legacy@a.test', passwordHash: 'x', role: 'BURSAR' } });
    expect(await rolesOf(u.id)).toEqual(['BURSAR']);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'LIBRARIAN' } });
    expect(await rolesOf(u.id)).toEqual(['LIBRARIAN']);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'HEAD' } });
    expect(await rolesOf(u.id)).toEqual(['HEAD']);
    const viaOld = await call('admin/users', 'POST', { as: admin(), body: { fullName: 'Old Route', email: 'oldroute@a.test', role: 'HEAD' } });
    expect(viaOld.status).toBe(201);
    expect(await rolesOf((await prisma.user.findFirstOrThrow({ where: { email: 'oldroute@a.test' } })).id)).toEqual(['HEAD']);
  });

  it('the database refuses a bad phone or title', async () => {
    const id = A.users.TEACHER.id;
    await expect(prisma.user.update({ where: { id }, data: { phone: '0771234567' } })).rejects.toThrow();
    await expect(prisma.user.update({ where: { id }, data: { title: 'Prof' } })).rejects.toThrow();
    await prisma.user.update({ where: { id }, data: { phone: '+263771234567', title: 'Mr' } });
  });
});

describe('the page', () => {
  it('renders for an administrator, with the filters in the address, and is denied to others', async () => {
    session.current = { ...admin() };
    const mod = await import('@/app/(dashboard)/admin/users/page');
    for (const sp of [{}, { status: 'invited' }, { role: 'TEACHER', q: 'moyo', sort: 'lastLoginAt', dir: 'desc', page: '2' }, { role: 'GOD', sort: 'passwordHash' }]) {
      expect(await mod.default({ searchParams: sp })).toBeTruthy();
    }
    session.current = { ...A.users.TEACHER };
    const denied = (await mod.default({ searchParams: {} })) as { type: { name: string } };
    expect(denied.type.name).toBe('AccessDenied');
  });
});
