// @vitest-environment node
// The Pfuma console: staff sign-in, creating a school, modules, billing, suspension, invoices, support access.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  auth: (await import('../helpers/session')).mockAuth,
}));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let adminId = '';
let cookie = '';
let n = 0;

const PASSWORD = 'Platform-pass-123';
const ip = () => ({ 'x-forwarded-for': `10.1.0.${++n}` }); // a fresh address, so one test's failed logins never lock another
const as = (c = cookie) => ({ headers: { cookie: `pfuma_platform=${c}` } });
const tokenOf = (url: string) => /reset-password\/([A-Za-z0-9_-]+)/.exec(url)![1];
const person = (name: string) => ({ fullName: `${name} Person`, email: `${name}@newschool.test`, phone: '0771234567' });
const newSchool = (over: object = {}) => ({
  name: 'Chipembere High', schoolType: 'GOVERNMENT', province: 'Harare', preset: 'GOVERNMENT_DAY', status: 'TRIAL', renewalDate: '2027-01-15', studentLimit: 600,
  owner: person('owner'), administrator: person('administrator'), ...over,
});
const login = (email: string, password: string, headers = ip()) => call('platform/login', 'POST', { body: { email, password }, headers });
const platformAudit = (where: object = {}) => prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NEXTAUTH_SECRET = 'platform-test-secret';
  process.env.AUTH_SECRET = 'platform-test-secret';
  process.env.NEXTAUTH_URL = 'https://pfuma.test';
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  const admin = await prisma.platformAdmin.create({ data: { fullName: 'Pfuma Staff', email: 'staff@pfuma.test', passwordHash: bcrypt.hashSync(PASSWORD, 4) } });
  adminId = admin.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

beforeEach(async () => {
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
  (await import('@/lib/scoped-db'))._resetSuspendedCache();
});

describe('signing in to the console', () => {
  it('refuses a wrong password and an unknown email with the same words, and logs the failure for a known admin only', async () => {
    const wrong = await login('staff@pfuma.test', 'not-the-password');
    const unknown = await login('nobody@pfuma.test', 'not-the-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.message).toBe(unknown.json.message);
    expect(wrong.response.headers.get('set-cookie')).toBeNull();
    const failures = await platformAudit({ action: 'LOGIN_FAILED' });
    expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.every((f) => f.entityId === adminId)).toBe(true);
  });

  it('signs a good password in with an httpOnly strict cookie, and records it', async () => {
    const r = await login('Staff@Pfuma.test', PASSWORD);
    expect(r.status).toBe(200);
    const set = r.response.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^pfuma_platform=/);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    cookie = /pfuma_platform=([^;]+)/.exec(set)![1];
    expect(JSON.stringify(r.json)).not.toMatch(/passwordHash/);
    expect((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: adminId } })).lastLoginAt).not.toBeNull();
    expect((await platformAudit({ action: 'LOGIN_SUCCESS' })).length).toBe(1);
  });

  it('locks an email and address for 15 minutes after five wrong passwords, even for the right one', async () => {
    const h = ip();
    for (let i = 0; i < 4; i++) expect((await login('staff@pfuma.test', 'wrong-wrong-1', h)).status).toBe(401);
    expect((await login('staff@pfuma.test', 'wrong-wrong-1', h)).status).toBe(429);
    expect((await login('staff@pfuma.test', PASSWORD, h)).status).toBe(429);
    expect((await login('staff@pfuma.test', PASSWORD)).status).toBe(200); // another address is not locked
    expect((await platformAudit({ action: 'LOGIN_LOCKED' })).length).toBe(1);
  });

  it('refuses a deactivated admin', async () => {
    await prisma.platformAdmin.create({ data: { fullName: 'Gone', email: 'gone@pfuma.test', passwordHash: bcrypt.hashSync(PASSWORD, 4), active: false } });
    expect((await login('gone@pfuma.test', PASSWORD)).status).toBe(401);
  });

  it('rejects bad input', async () => {
    expect((await call('platform/login', 'POST', { body: {}, headers: ip() })).status).toBe(422);
    expect((await call('platform/login', 'POST', { rawBody: '{nope', headers: ip() })).status).toBe(400);
  });
});

describe('who may use the console', () => {
  const routes: [string, 'GET' | 'POST' | 'PATCH', Record<string, string>?][] = [
    ['platform/schools', 'GET'], ['platform/schools', 'POST'], ['platform/schools/[id]', 'GET', { id: 'x' }], ['platform/schools/[id]', 'PATCH', { id: 'x' }],
    ['platform/schools/[id]/modules', 'PATCH', { id: 'x' }], ['platform/schools/[id]/suspend', 'POST', { id: 'x' }], ['platform/schools/[id]/reactivate', 'POST', { id: 'x' }],
    ['platform/schools/[id]/invoices', 'POST', { id: 'x' }], ['platform/invoices/[id]/pay', 'POST', { id: 'x' }], ['platform/schools/[id]/support', 'POST', { id: 'x' }],
  ];

  it('answers 401 to everyone without the console cookie, including a signed-in school administrator', async () => {
    for (const [file, method, params] of routes) {
      const body = method === 'GET' ? undefined : {};
      expect((await call(file, method, { as: null, params, body })).status, `${method} ${file}`).toBe(401);
      expect((await call(file, method, { as: A.users.ADMIN, params, body })).status, `school admin ${method} ${file}`).toBe(401);
      expect((await call(file, method, { params, body, headers: { cookie: 'pfuma_platform=junk.1.2.3' } })).status, `forged ${method} ${file}`).toBe(401);
    }
  });

  it('does not accept the school session cookie, or a console cookie with the wrong version', async () => {
    const { signPlatformToken } = await import('@/lib/platform/session');
    const stale = signPlatformToken(adminId, 99);
    expect((await call('platform/schools', 'GET', as(stale))).status).toBe(401);
    expect((await call('platform/schools', 'GET', { headers: { cookie: `authjs.session-token=${cookie}` } })).status).toBe(401);
  });

  it('ends a console session at once when the admin is deactivated or the password changes', async () => {
    const other = await prisma.platformAdmin.create({ data: { fullName: 'Temp', email: 'temp@pfuma.test', passwordHash: bcrypt.hashSync(PASSWORD, 4) } });
    const c = /pfuma_platform=([^;]+)/.exec((await login('temp@pfuma.test', PASSWORD)).response.headers.get('set-cookie') ?? '')![1];
    expect((await call('platform/schools', 'GET', as(c))).status).toBe(200);
    await prisma.platformAdmin.update({ where: { id: other.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await call('platform/schools', 'GET', as(c))).status).toBe(401);
    const c2 = /pfuma_platform=([^;]+)/.exec((await login('temp@pfuma.test', PASSWORD)).response.headers.get('set-cookie') ?? '')![1];
    await prisma.platformAdmin.update({ where: { id: other.id }, data: { active: false } });
    expect((await call('platform/schools', 'GET', as(c2))).status).toBe(401);
  });

  it('signs out by clearing the cookie', async () => {
    const r = await call('platform/logout', 'POST', {});
    expect(r.response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('creating a school', () => {
  let created: { school: { id: string; name: string }; invites: { role: string; fullName: string; email: string; url: string }[] };

  it('refuses bad input and creates nothing', async () => {
    const before = await prisma.school.count();
    const bad: object[] = [{ name: 'x' }, { province: 'Atlantis' }, { preset: 'NOPE' }, { administrator: person('owner') }, { owner: { ...person('o'), phone: '1' } }, { renewalDate: '2027-02-30' }];
    for (const b of bad) expect((await call('platform/schools', 'POST', { ...as(), body: newSchool(b) })).status, JSON.stringify(b)).toBe(422);
    expect((await call('platform/schools', 'POST', { ...as(), rawBody: '{nope' })).status).toBe(400);
    expect(await prisma.school.count()).toBe(before);
  });

  it('makes the school, its 13 roles, an Owner and an Administrator, and an invite for each', async () => {
    const r = await call('platform/schools', 'POST', { ...as(), body: newSchool() });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    created = r.json.data;
    expect(created.invites.map((i) => i.role)).toEqual(['OWNER', 'ADMINISTRATOR']);
    for (const i of created.invites) expect(i.url).toMatch(/^https:\/\/pfuma\.test\/reset-password\/[A-Za-z0-9_-]{40,}\?invite=1$/);

    const school = await prisma.school.findUniqueOrThrow({ where: { id: created.school.id }, include: { plan: true } });
    expect(school).toMatchObject({ name: 'Chipembere High', schoolType: 'GOVERNMENT', province: 'Harare', boarding: 'DAY', status: 'TRIAL', studentLimit: 600 });
    expect(school.plan?.key).toBe('STANDARD');
    expect(school.renewalDate?.toISOString().slice(0, 10)).toBe('2027-01-15');

    const roles = await prisma.roleDefinition.findMany({ where: { schoolId: school.id }, include: { permissions: true } });
    expect(roles).toHaveLength(13);
    for (const key of ['OWNER', 'ADMINISTRATOR']) expect(roles.find((x) => x.key === key)!.permissions.map((p) => p.permissionKey), key).toContain('*');
    expect(roles.find((x) => x.key === 'TEACHER')!.permissions.map((p) => p.permissionKey).sort()).toEqual(['academics.assignments.view', 'academics.attendance.mark', 'academics.classes.view', 'academics.schemes.edit', 'academics.schemes.view', 'academics.subjects.view', 'academics.timetable.view', 'exams.analytics.view', 'exams.assessments.create', 'exams.comments.subject', 'exams.marks.enter', 'exams.marks.submit', 'system.calendar.view', 'system.dashboard.view']);

    const users = await prisma.user.findMany({ where: { schoolId: school.id }, include: { userRoles: { include: { role: true } } } });
    expect(users).toHaveLength(2);
    const byRole = Object.fromEntries(users.map((u) => [u.userRoles[0].role.key, u]));
    expect(byRole.OWNER).toMatchObject({ email: 'owner@newschool.test', fullName: 'Owner Person', phone: '+263771234567', invitePending: true, active: true });
    expect(byRole.ADMINISTRATOR).toMatchObject({ email: 'administrator@newschool.test', invitePending: true });
    expect(byRole.OWNER.passwordHash.startsWith('!invited!')).toBe(true);
  });

  it('keeps only a hash of each invite, valid 72 hours, and lets each person choose a password once', async () => {
    const tokens = await prisma.passwordResetToken.findMany({ where: { schoolId: created.school.id } });
    expect(tokens).toHaveLength(2);
    for (const k of tokens) {
      expect(k.kind).toBe('INVITE');
      const hours = (k.expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(71.9);
      expect(hours).toBeLessThanOrEqual(72);
      for (const i of created.invites) expect(k.tokenHash).not.toContain(tokenOf(i.url));
    }
    const use = (url: string, newPassword: string) => call('password-reset', 'POST', { body: { token: tokenOf(url), newPassword } });
    expect((await use(created.invites[0].url, 'Owner-chooses-this-1')).status).toBe(200);
    expect((await use(created.invites[0].url, 'Another-password-12')).status).toBe(410);
    const { authorizeCredentials } = await import('@/lib/auth');
    expect(await authorizeCredentials({ email: 'owner@newschool.test', password: 'Owner-chooses-this-1' })).toMatchObject({ schoolId: created.school.id });
  });

  it('turns the preset into module switches and records everything in the platform audit', async () => {
    const mods = await prisma.schoolModule.findMany({ where: { schoolId: created.school.id } });
    expect(mods.find((m) => m.module === 'facilities')).toMatchObject({ enabled: false, enabledByPlatformAdminId: adminId });
    expect(mods.find((m) => m.module === 'finance')).toMatchObject({ enabled: true });
    expect(mods.find((m) => m.module === 'system')?.enabled).toBe(true);
    const entry = (await platformAudit({ action: 'SCHOOL_CREATED', schoolId: created.school.id }))[0];
    expect(entry.adminId).toBe(adminId);
    expect(entry.detail).toContain('Government day school');
    expect(JSON.stringify(entry)).not.toContain(tokenOf(created.invites[0].url));
  });

  it('lists and finds it, and gives a detail view', async () => {
    const list = await call('platform/schools', 'GET', { ...as(), query: '?q=chipembere' });
    expect(list.json.data.total).toBe(1);
    expect(list.json.data.rows[0]).toMatchObject({ id: created.school.id, status: 'TRIAL', studentLimit: 600 });
    expect((await call('platform/schools', 'GET', { ...as(), query: '?status=SUSPENDED&q=chipembere' })).json.data.total).toBe(0);
    expect((await call('platform/schools', 'GET', { ...as(), query: '?q=zzzz-nothing' })).json.data.total).toBe(0);
    const all = await call('platform/schools', 'GET', { ...as() });
    expect(all.json.data.total).toBeGreaterThanOrEqual(2);
    const d = await call('platform/schools/[id]', 'GET', { ...as(), params: { id: created.school.id } });
    expect(d.status).toBe(200);
    expect(d.json.data.people).toHaveLength(2);
    expect((await call('platform/schools/[id]', 'GET', { ...as(), params: { id: 'nope' } })).status).toBe(404);
  });

  it('refuses a plan that does not exist', async () => {
    expect((await call('platform/schools', 'POST', { ...as(), body: newSchool({ planId: 'no-such-plan', owner: person('o2'), administrator: person('a2') }) })).status).toBe(422);
  });

  describe('modules, plan and student limit', () => {
    it('switches modules and applies presets, and says what changed', async () => {
      const id = created.school.id;
      const r = await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body: { modules: { communication: false, hr: false } } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.data.modules).toMatchObject({ communication: false, hr: false, finance: true, facilities: false, system: true });
      const entry = (await platformAudit({ action: 'MODULES_CHANGED', schoolId: id })).at(-1)!;
      expect(entry.detail).toContain('communication off');
      expect(entry.before).toMatchObject({ communication: true });
      expect(entry.after).toMatchObject({ communication: false });

      const p = await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body: { preset: 'GOVERNMENT_BOARDING' } });
      expect(p.json.data.modules).toMatchObject(Object.fromEntries(Object.keys(p.json.data.modules).map((k) => [k, true])));
      const n0 = (await platformAudit({ action: 'MODULES_CHANGED', schoolId: id })).length;
      await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body: { preset: 'GOVERNMENT_BOARDING' } });
      expect((await platformAudit({ action: 'MODULES_CHANGED', schoolId: id })).length).toBe(n0); // a repeat changes and logs nothing
    });

    it('refuses to switch System off, unknown modules, an empty change and a missing school', async () => {
      const id = created.school.id;
      for (const body of [{ modules: { system: false } }, { modules: { payroll: true } }, {}]) {
        expect((await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body })).status, JSON.stringify(body)).toBe(422);
      }
      expect((await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id: 'nope' }, body: { preset: 'PRIVATE' } })).status).toBe(404);
    });

    it('is what the school then sees: a switched-off module refuses its keys even to its administrator', async () => {
      const id = created.school.id;
      await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body: { modules: { finance: false } } });
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: id, email: 'administrator@newschool.test' } });
      session.current = { id: admin.id, email: admin.email, schoolId: id, role: 'ADMIN', fullName: admin.fullName };
      const { requirePermission } = await import('@/lib/access');
      await expect(requirePermission('finance.payments.view')).rejects.toMatchObject({ status: 403 });
      await expect(requirePermission('system.users.view')).resolves.toBeTruthy();
      await call('platform/schools/[id]/modules', 'PATCH', { ...as(), params: { id }, body: { modules: { finance: true } } });
      session.current = { id: admin.id, email: admin.email, schoolId: id, role: 'ADMIN', fullName: admin.fullName };
      await expect(requirePermission('finance.payments.view')).resolves.toBeTruthy();
    });

    it('changes plan, student limit, renewal date and status, with before and after', async () => {
      const id = created.school.id;
      const r = await call('platform/schools/[id]', 'PATCH', { ...as(), params: { id }, body: { studentLimit: 900, renewalDate: '2027-03-01', status: 'ACTIVE' } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(await prisma.school.findUniqueOrThrow({ where: { id } })).toMatchObject({ studentLimit: 900, status: 'ACTIVE' });
      const entry = (await platformAudit({ action: 'BILLING_CHANGED', schoolId: id })).at(-1)!;
      expect(entry.before).toMatchObject({ studentLimit: 600, status: 'TRIAL', renewalDate: '2027-01-15' });
      expect(entry.after).toMatchObject({ studentLimit: 900, status: 'ACTIVE', renewalDate: '2027-03-01' });
      expect((await call('platform/schools/[id]', 'PATCH', { ...as(), params: { id }, body: { studentLimit: '' } })).status).toBe(200);
      expect((await prisma.school.findUniqueOrThrow({ where: { id } })).studentLimit).toBeNull();
      for (const body of [{}, { status: 'SUSPENDED' }, { studentLimit: -4 }, { planId: 'no-such-plan' }]) {
        expect((await call('platform/schools/[id]', 'PATCH', { ...as(), params: { id }, body })).status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('suspending and reactivating', () => {
    let admin: { id: string; email: string; fullName: string };
    const school = () => created.school.id;
    const asAdmin = () => { session.current = { id: admin.id, email: admin.email, schoolId: school(), role: 'ADMIN', fullName: admin.fullName }; return session.current as never; };

    beforeAll(async () => {
      admin = await prisma.user.findFirstOrThrow({ where: { schoolId: created.school.id, email: 'administrator@newschool.test' } });
    });

    it('needs a reason', async () => {
      expect((await call('platform/schools/[id]/suspend', 'POST', { ...as(), params: { id: school() }, body: {} })).status).toBe(422);
      expect((await call('platform/schools/[id]/reactivate', 'POST', { ...as(), params: { id: school() } })).status).toBe(409); // not suspended
    });

    it('lets people sign in and look, but not create or change anything, however the change is made', async () => {
      const ev = { title: 'Open day', kind: 'OTHER', startDate: '2027-02-01', endDate: '2027-02-01' };
      expect((await call('system/calendar', 'POST', { as: asAdmin(), body: ev })).status).toBe(201); // fine before

      const r = await call('platform/schools/[id]/suspend', 'POST', { ...as(), params: { id: school() }, body: { reason: 'Term 1 invoice unpaid' } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      (await import('@/lib/scoped-db'))._resetSuspendedCache();
      expect(await prisma.school.findUniqueOrThrow({ where: { id: school() } })).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Term 1 invoice unpaid' });

      // looking
      for (const f of ['system/calendar', 'system/users', 'system/audit-log', 'system/settings']) { const g = await call(f as never, 'GET', { as: asAdmin() }); expect(g.status, f + ' ' + g.text.slice(0, 200)).toBe(200); }
      // changing, through the routes that ask can()
      expect((await call('system/calendar', 'POST', { as: asAdmin(), body: ev })).status).toBe(403);
      expect((await call('system/users', 'POST', { as: asAdmin(), body: { fullName: 'No One', email: 'noone@newschool.test', phone: '0771234567', roles: ['TEACHER'] } })).status).toBe(403);
      expect((await call('system/settings/defaults', 'PATCH', { as: asAdmin(), body: { maxClassSize: 40 } })).status).toBe(403);
      // changing, through a route that never asks can(): the database client itself refuses
      const old = await call('admin/users', 'POST', { as: asAdmin(), body: { fullName: 'Old Route', email: 'old@newschool.test', role: 'HEAD' } });
      expect(old.status).toBe(403);
      expect(old.json.message).toMatch(/suspended/i);
      expect(await prisma.user.count({ where: { email: 'old@newschool.test' } })).toBe(0);

      // but the notes the system itself writes, and people's own passwords, still work
      const { getScopedDb, SchoolSuspendedError } = await Promise.all([import('@/lib/scoped-db'), import('@/lib/errors')]).then(([a, b]) => ({ ...a, ...b }));
      const db = getScopedDb(school(), admin.id);
      await expect(db.calendarEvent.create({ data: { title: 'x', startDate: new Date('2027-02-02'), endDate: new Date('2027-02-02'), createdById: admin.id } as never })).rejects.toBeInstanceOf(SchoolSuspendedError);
      await expect(db.$tx((tx) => tx.calendarEvent.deleteMany({}))).rejects.toBeInstanceOf(SchoolSuspendedError);
      await expect(db.notification.create({ data: { userId: admin.id, title: 'Still works' } as never })).resolves.toBeTruthy();
      await expect(db.user.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })).resolves.toBeTruthy();
      // ... and other schools are not affected
      const other = await call('system/calendar', 'POST', { as: A.users.ADMIN, body: { title: 'School A open day', kind: 'OTHER', startDate: '2026-05-05', endDate: '2026-05-05' } });
      expect(other.status, other.text.slice(0, 200)).toBe(201);
    });

    it('tells the school, shows the banner text, and is logged', async () => {
      const notes = await prisma.notification.findMany({ where: { schoolId: school(), type: 'SUBSCRIPTION' } });
      expect(notes.some((x) => x.userId === admin.id && /suspended/i.test(x.title))).toBe(true);
      expect((await platformAudit({ action: 'SCHOOL_SUSPENDED', schoolId: school() }))[0].detail).toContain('Term 1 invoice unpaid');
      const { subscriptionView } = await import('@/lib/system/subscription');
      const row = await prisma.school.findUniqueOrThrow({ where: { id: school() } });
      expect(subscriptionView(row).banner).toMatchObject({ kind: 'suspended' });
      expect((await call('platform/schools/[id]/suspend', 'POST', { ...as(), params: { id: school() }, body: { reason: 'Again please' } })).status).toBe(409);
      expect((await call('platform/schools/[id]', 'PATCH', { ...as(), params: { id: school() }, body: { status: 'ACTIVE' } })).status).toBe(409);
    });

    it('lets people change things again once reactivated', async () => {
      const r = await call('platform/schools/[id]/reactivate', 'POST', { ...as(), params: { id: school() } });
      expect(r.status).toBe(200);
      (await import('@/lib/scoped-db'))._resetSuspendedCache();
      expect(await prisma.school.findUniqueOrThrow({ where: { id: school() } })).toMatchObject({ status: 'ACTIVE', suspendedReason: null });
      expect((await call('system/calendar', 'POST', { as: asAdmin(), body: { title: 'After', kind: 'OTHER', startDate: '2027-02-03', endDate: '2027-02-03' } })).status).toBe(201);
      expect((await platformAudit({ action: 'SCHOOL_REACTIVATED', schoolId: school() })).length).toBe(1);
    });
  });

  describe('invoices', () => {
    it('numbers them PFU-year-0001 onward, and records who made them', async () => {
      const id = created.school.id;
      const a = await call('platform/schools/[id]/invoices', 'POST', { ...as(), params: { id }, body: { amount: '120.5', description: 'Standard plan, Term 1', issuedOn: '2027-01-05', dueOn: '2027-01-31' } });
      expect(a.status, JSON.stringify(a.json)).toBe(201);
      expect(a.json.data.invoice.number).toBe('PFU-2027-0001');
      const b = await call('platform/schools/[id]/invoices', 'POST', { ...as(), params: { id }, body: { amount: 80, currency: 'ZIG', description: 'SMS bundle', issuedOn: '2027-01-06' } });
      expect(b.json.data.invoice.number).toBe('PFU-2027-0002');
      const row = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: a.json.data.invoice.id } });
      expect(row).toMatchObject({ schoolId: id, status: 'OPEN', currency: 'USD', createdByAdminId: adminId, description: 'Standard plan, Term 1' });
      expect(row.amount.toFixed(2)).toBe('120.50');
      expect((await platformAudit({ action: 'INVOICE_CREATED', schoolId: id })).length).toBe(2);
    });

    it('refuses bad amounts and a missing school', async () => {
      const id = created.school.id;
      for (const body of [{ amount: 0, description: 'x fee' }, { amount: -1, description: 'x fee' }, { amount: 5, description: '' }, { amount: 5, description: 'x fee', currency: 'EUR' }]) {
        expect((await call('platform/schools/[id]/invoices', 'POST', { ...as(), params: { id }, body })).status, JSON.stringify(body)).toBe(422);
      }
      expect((await call('platform/schools/[id]/invoices', 'POST', { ...as(), params: { id: 'nope' }, body: { amount: 5, description: 'x fee' } })).status).toBe(404);
    });

    it('is marked paid once, and then the school sees it as paid', async () => {
      const id = created.school.id;
      const open = await prisma.subscriptionInvoice.findFirstOrThrow({ where: { schoolId: id, number: 'PFU-2027-0001' } });
      const r = await call('platform/invoices/[id]/pay', 'POST', { ...as(), params: { id: open.id }, body: { paidOn: '2027-01-20' } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: 'PAID' });
      expect((await call('platform/invoices/[id]/pay', 'POST', { ...as(), params: { id: open.id } })).status).toBe(409);
      expect((await call('platform/invoices/[id]/pay', 'POST', { ...as(), params: { id: 'nope' } })).status).toBe(404);
      expect((await platformAudit({ action: 'INVOICE_PAID', schoolId: id })).length).toBe(1);

      // the school's own page and PDF
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: id, email: 'administrator@newschool.test' } });
      const school = { id: admin.id, email: admin.email, schoolId: id, role: 'ADMIN', fullName: admin.fullName };
      const pdf = await call('system/subscription/invoices/[id]/pdf', 'GET', { as: school as never, params: { id: open.id } });
      expect(pdf.status).toBe(200);
      expect(pdf.response.headers.get('content-type')).toBe('application/pdf');
      expect(pdf.response.headers.get('content-disposition')).toContain('PFU-2027-0001.pdf');
      session.current = school;
      const page = await (await import('@/app/(dashboard)/system/subscription/page')).default();
      expect((page as { type?: { name?: string } }).type?.name).not.toBe('AccessDenied');
    });

    it('cannot be changed from the school side', async () => {
      const { getScopedDb } = await import('@/lib/scoped-db');
      const db = getScopedDb(created.school.id);
      await expect(db.subscriptionInvoice.updateMany({ data: { amount: '1.00' } })).rejects.toThrow(/cannot be changed/);
      await expect(db.subscriptionInvoice.deleteMany({})).rejects.toThrow(/cannot be changed/);
      expect(await db.subscriptionInvoice.count()).toBe(2);
    });
  });

  describe('support access', () => {
    const school = () => created.school.id;

    it('needs a reason of some substance, and a school that exists', async () => {
      for (const reason of [undefined, '', 'short']) expect((await call('platform/schools/[id]/support', 'POST', { ...as(), params: { id: school() }, body: { reason } })).status, String(reason)).toBe(422);
      expect((await call('platform/schools/[id]/support', 'POST', { ...as(), params: { id: 'nope' }, body: { reason: 'A good enough reason' } })).status).toBe(404);
      expect(await prisma.user.count({ where: { schoolId: school(), isSupport: true } })).toBe(0);
    });

    let supportUser: { id: string };
    it('opens a 30-minute read-only session as a hidden user and writes the reason to both audit logs', async () => {
      const r = await call('platform/schools/[id]/support', 'POST', { ...as(), params: { id: school() }, body: { reason: 'Bursar reported a wrong balance' } });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      const set = r.response.headers.get('set-cookie') ?? '';
      expect(set).toMatch(/^__Secure-authjs\.session-token=/);
      expect(set).toContain('HttpOnly');
      expect(set).toContain('Max-Age=1800');

      const { decode } = await import('next-auth/jwt');
      const value = /session-token=([^;]+)/.exec(set)![1];
      const token = await decode({ token: value, secret: 'platform-test-secret', salt: '__Secure-authjs.session-token' });
      supportUser = await prisma.user.findFirstOrThrow({ where: { schoolId: school(), isSupport: true } });
      expect(token).toMatchObject({ id: supportUser.id, schoolId: school(), support: true, supportAdminId: adminId, role: 'ADMIN' });

      const inSchool = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: school(), action: 'SUPPORT_ACCESS_STARTED' } });
      expect(inSchool.actorId).toBe(supportUser.id);
      expect(inSchool.detail).toContain('Bursar reported a wrong balance');
      expect(inSchool.detail).toContain('staff@pfuma.test');
      expect(inSchool.module).toBe('system');
      expect((await platformAudit({ action: 'SUPPORT_ACCESS_STARTED', schoolId: school() }))[0].detail).toContain('Bursar reported a wrong balance');
    });

    it('reuses the same hidden user next time, and never lists it among the school\'s people', async () => {
      await call('platform/schools/[id]/support', 'POST', { ...as(), params: { id: school() }, body: { reason: 'Looking again at the same thing' } });
      expect(await prisma.user.count({ where: { schoolId: school(), isSupport: true } })).toBe(1);
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school(), email: 'administrator@newschool.test' } });
      const list = await call('system/users', 'GET', { as: { id: admin.id, email: admin.email, schoolId: school(), role: 'ADMIN', fullName: admin.fullName } as never, query: '?pageSize=100' });
      expect(list.json.data.users.map((u: { email: string }) => u.email)).not.toContain('pfuma-support@platform.invalid');
      expect(list.json.data.counts.active + list.json.data.counts.invited + list.json.data.counts.deactivated).toBe(list.json.data.total);
      const { authorizeCredentials } = await import('@/lib/auth');
      expect(await authorizeCredentials({ email: 'pfuma-support@platform.invalid', password: '!support!never-signs-in-with-a-password' })).toBeNull();
    });

    it('can look at everything and change, delete or export nothing', async () => {
      const s = () => { session.current = { id: supportUser.id, email: 'pfuma-support@platform.invalid', schoolId: school(), role: 'ADMIN', fullName: 'Pfuma support', support: true }; return session.current as never; };
      for (const f of ['system/users', 'system/calendar', 'system/audit-log', 'system/settings']) expect((await call(f as never, 'GET', { as: s() })).status, f).toBe(200);
      expect((await call('system/users', 'POST', { as: s(), body: { fullName: 'No One', email: 'noone2@newschool.test', phone: '0771234567', roles: ['TEACHER'] } })).status).toBe(403);
      expect((await call('system/calendar', 'POST', { as: s(), body: { title: 'x', kind: 'OTHER', startDate: '2027-03-01', endDate: '2027-03-01' } })).status).toBe(403);
      expect((await call('system/settings/profile', 'PATCH', { as: s(), body: { name: 'Hacked' } })).status).toBe(403);
      expect((await call('system/users', 'GET', { as: s(), query: '?format=csv' })).status).toBe(403);       // no exports of people's details
      expect((await call('system/audit-log', 'GET', { as: s(), query: '?format=csv' })).status).toBe(403);
      expect((await call('system/users/[id]/reset-password', 'POST', { as: s(), params: { id: supportUser.id } })).status).toBe(403);
      expect((await call('platform/schools', 'GET', { as: s() })).status).toBe(401);                          // and it is not a console login
    });

    it('is ended from the school side, which logs it and clears the session', async () => {
      const s = { id: supportUser.id, email: 'pfuma-support@platform.invalid', schoolId: school(), role: 'ADMIN', fullName: 'Pfuma support', support: true, supportAdminId: adminId };
      const r = await call('system/support/end', 'POST', { as: s as never });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(r.json.data.redirect).toBe(`/platform/schools/${school()}`);
      expect(await prisma.auditLog.count({ where: { schoolId: school(), action: 'SUPPORT_ACCESS_ENDED' } })).toBe(1);
      expect((await platformAudit({ action: 'SUPPORT_ACCESS_ENDED', schoolId: school() })).length).toBe(1);
      // only a support session can use it
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school(), email: 'administrator@newschool.test' } });
      expect((await call('system/support/end', 'POST', { as: { id: admin.id, email: admin.email, schoolId: school(), role: 'ADMIN', fullName: admin.fullName } as never })).status).toBe(403);
      expect((await call('system/support/end', 'POST', { as: null })).status).toBe(401);
    });
  });
});

describe('the console audit', () => {
  it('has an entry for each action, with who, which school, and the address', async () => {
    const rows = await platformAudit();
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'SCHOOL_CREATED', 'MODULES_CHANGED', 'BILLING_CHANGED', 'SCHOOL_SUSPENDED', 'SCHOOL_REACTIVATED', 'INVOICE_CREATED', 'INVOICE_PAID', 'SUPPORT_ACCESS_STARTED', 'SUPPORT_ACCESS_ENDED']) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(rows.every((r) => !!r.adminId)).toBe(true);
    expect(rows.filter((r) => r.action === 'SCHOOL_CREATED').every((r) => r.schoolId !== null)).toBe(true);
  });

  it('cannot be edited or deleted', async () => {
    await expect(prisma.platformAuditLog.deleteMany({})).rejects.toThrow(/cannot be changed or deleted/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    await expect(prisma.platformAuditLog.updateMany({ data: { detail: 'x' } })).rejects.toThrow(/cannot be changed or deleted/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
  });
});

describe('the console never edits a school\'s own records', () => {
  it('touches only account tables: school account fields, modules, invoices, plans, the first two users and their invites, notifications', () => {
    const root = path.resolve(__dirname, '../..');
    const files = [
      ...fs.readdirSync(path.join(root, 'lib/platform')).map((f) => path.join(root, 'lib/platform', f)),
      ...(function walk(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      })(path.join(root, 'app/api/platform')),
    ];
    const allowed = new Set(['school', 'schoolModule', 'subscriptionInvoice', 'plan', 'user', 'passwordResetToken', 'notification', 'platformAdmin', 'platformAuditLog', 'auditLog']);
    const used = new Set<string>();
    for (const f of files) {
      for (const m of Array.from(fs.readFileSync(f, 'utf8').matchAll(/\b(?:prisma|tx|db)\.([a-z][A-Za-z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g))) used.add(m[1]);
    }
    expect(Array.from(used).filter((m) => !allowed.has(m))).toEqual([]);
    expect(used.has('student')).toBe(false);
    expect(used.has('payment')).toBe(false);
  });
});
