// @vitest-environment node
// Dashboard & System: permission checks on every route, school isolation, input
// validation, audit rows written in the same transaction, module switches, the term
// switcher, notifications, and the shared table behaviour (search, filter, sort, page, CSV).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, ROLES, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

// Lets a test make the audit write fail, to prove the change is rolled back with it.
const audit = vi.hoisted(() => ({ failNext: false }));
vi.mock('@/lib/audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/audit')>();
  return {
    ...real,
    logAudit: (...args: Parameters<typeof real.logAudit>) => {
      if (audit.failNext) return Promise.reject(new Error('audit write failed'));
      return real.logAudit(...args);
    },
  };
});

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const admin = () => A.users.ADMIN;
const owner = () => A.users.DIRECTOR;
const OTHERS = ['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const;

const auditCount = (where: Record<string, unknown> = {}) => prisma.auditLog.count({ where: { schoolId: A.schoolId, ...where } });

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

beforeEach(async () => {
  audit.failNext = false;
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
});

// ─── Who may call what ───────────────────────────────────────────────────────

describe('every System route goes through the permission check', () => {
  const routes: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', Record<string, unknown>?, string?][] = [
    ['system/users', 'GET'],
    ['system/users', 'POST', { fullName: 'Nope Nobody', email: 'nope@a.test', role: 'TEACHER' }],
    ['system/users/[id]', 'PATCH', { fullName: 'Nope Nobody' }, 'TEACHER'],
    ['system/users/[id]/deactivate', 'POST', undefined, 'TEACHER'],
    ['system/users/[id]/reactivate', 'POST', undefined, 'TEACHER'],
    ['system/users/[id]/reset-password', 'POST', undefined, 'TEACHER'],
    ['system/settings', 'GET'],
    ['system/settings', 'PATCH', { name: 'Hacked School', schoolType: 'PRIVATE', defaultCurrency: 'USD', maxClassSize: 40 }],
    ['system/calendar', 'GET'],
    ['system/calendar', 'POST', { title: 'Party', kind: 'OTHER', startDate: '2026-05-01', endDate: '2026-05-01' }],
    ['system/audit-log', 'GET'],
    ['system/subscription/modules', 'GET'],
    ['system/subscription/modules', 'PATCH', { modules: { finance: false } }],
  ];

  const target = (id: string | undefined) => (id ? { id: A.users[id as keyof typeof A.users].id } : undefined);

  for (const role of OTHERS) {
    it(`refuses ${role} on all of them, and changes nothing`, async () => {
      const before = { users: await prisma.user.count(), audits: await prisma.auditLog.count(), school: (await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name };
      for (const [file, method, body, who] of routes) {
        const r = await call(file, method, { as: A.users[role], body, params: target(who) });
        expect(r.status, `${role} ${method} ${file}`).toBe(403);
      }
      const csv = await call('system/audit-log', 'GET', { as: A.users[role], query: '?format=csv' });
      expect(csv.status).toBe(403);
      expect(await prisma.user.count()).toBe(before.users);
      expect(await prisma.auditLog.count()).toBe(before.audits);
      expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name).toBe(before.school);
    });
  }

  it('answers 401 to someone who is not signed in', async () => {
    for (const [file, method, body, who] of routes) {
      const r = await call(file, method, { as: null, body, params: target(who) });
      expect(r.status, `${method} ${file}`).toBe(401);
    }
  });

  it('lets the administrator and the owner in', async () => {
    for (const who of [admin(), owner()]) {
      expect((await call('system/users', 'GET', { as: who })).status).toBe(200);
      expect((await call('system/settings', 'GET', { as: who })).status).toBe(200);
      expect((await call('system/audit-log', 'GET', { as: who })).status).toBe(200);
      expect((await call('system/calendar', 'GET', { as: who })).status).toBe(200);
    }
  });

  it('turns a role into an allowed one by changing data only: a RolePermission row', async () => {
    expect((await call('system/users', 'GET', { as: A.users.HEAD })).status).toBe(403);
    await prisma.rolePermission.create({ data: { schoolId: A.schoolId, role: 'HEAD', permission: 'system.users.view' } });
    expect((await call('system/users', 'GET', { as: A.users.HEAD })).status).toBe(200);
    expect((await call('system/users', 'POST', { as: A.users.HEAD, body: { fullName: 'Still No', email: 'stillno@a.test', role: 'TEACHER' } })).status).toBe(403);
    await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId } });
    expect((await call('system/users', 'GET', { as: A.users.HEAD })).status).toBe(403);
  });

  it('never lets a grant in one school reach a user of another', async () => {
    await prisma.rolePermission.create({ data: { schoolId: B.schoolId, role: 'HEAD', permission: 'system.users.view' } });
    expect((await call('system/users', 'GET', { as: A.users.HEAD })).status).toBe(403);
    expect((await call('system/users', 'GET', { as: B.users.HEAD })).status).toBe(200);
    await prisma.rolePermission.deleteMany({ where: { schoolId: B.schoolId } });
  });
});

// ─── Users ───────────────────────────────────────────────────────────────────

describe('users', () => {
  let newId: string;

  it('adds a user with a one-time password, an audit row and a notification for the other administrators', async () => {
    const before = await auditCount({ action: 'CREATE_USER' });
    const r = await call('system/users', 'POST', { as: admin(), body: { fullName: '  Rudo Chari ', email: 'Rudo.Chari@A.test', role: 'TEACHER' } });
    expect(r.status).toBe(201);
    expect(r.json.data.tempPassword.length).toBeGreaterThanOrEqual(10);
    expect(r.json.data.user).toMatchObject({ fullName: 'Rudo Chari', email: 'rudo.chari@a.test', role: 'TEACHER', active: true });
    expect(JSON.stringify(r.json)).not.toMatch(/passwordHash/);
    newId = r.json.data.user.id;

    const row = await prisma.user.findUniqueOrThrow({ where: { id: newId } });
    expect(row.schoolId).toBe(A.schoolId);
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash).not.toContain(r.json.data.tempPassword);
    expect(await auditCount({ action: 'CREATE_USER' })).toBe(before + 1);

    const mine = await prisma.notification.count({ where: { userId: admin().id, title: 'User added' } });
    const theirs = await prisma.notification.count({ where: { userId: owner().id, title: 'User added' } });
    expect(mine).toBe(0);
    expect(theirs).toBe(1);
  });

  it('refuses a repeated email (any capitals) and bad input', async () => {
    expect((await call('system/users', 'POST', { as: admin(), body: { fullName: 'Dup One', email: 'RUDO.CHARI@a.test', role: 'TEACHER' } })).status).toBe(409);
    for (const body of [{}, { fullName: 'X', email: 'a@b.zw', role: 'TEACHER' }, { fullName: 'Okay Name', email: 'bad', role: 'TEACHER' }, { fullName: 'Okay Name', email: 'a@b.zw', role: 'GOD' }]) {
      expect((await call('system/users', 'POST', { as: admin(), body })).status, JSON.stringify(body)).toBe(422);
    }
    expect((await call('system/users', 'POST', { as: admin(), rawBody: '{nope' })).status).toBe(400);
  });

  it('rolls the user back when the audit write fails', async () => {
    audit.failNext = true;
    const r = await call('system/users', 'POST', { as: admin(), body: { fullName: 'Ghost User', email: 'ghost@a.test', role: 'TEACHER' } });
    expect(r.status).toBe(500);
    expect(await prisma.user.count({ where: { email: 'ghost@a.test' } })).toBe(0);
  });

  it('lists only this school, with search, filters, sort and pages', async () => {
    for (let i = 0; i < 12; i++) await prisma.user.create({ data: { schoolId: A.schoolId, fullName: `Bulk Person ${String(i).padStart(2, '0')}`, email: `bulk${i}@a.test`, role: 'LIBRARIAN', passwordHash: 'x' } });
    await prisma.user.create({ data: { schoolId: B.schoolId, fullName: 'Bulk Person Other School', email: 'bulkb@b.test', role: 'LIBRARIAN', passwordHash: 'x' } });

    const all = await call('system/users', 'GET', { as: admin(), query: '?pageSize=100' });
    expect(all.json.data.users.every((u: { email: string }) => !u.email.endsWith('@b.test') && !/school2/.test(u.email))).toBe(true);
    expect(all.json.data.users.length).toBe(all.json.data.total);
    expect(JSON.stringify(all.json)).not.toMatch(/passwordHash/);

    const search = await call('system/users', 'GET', { as: admin(), query: '?q=bulk%20person&pageSize=100' });
    expect(search.json.data.total).toBe(12);

    const page1 = await call('system/users', 'GET', { as: admin(), query: '?q=bulk%20person&pageSize=10&page=1&sort=fullName&dir=asc' });
    const page2 = await call('system/users', 'GET', { as: admin(), query: '?q=bulk%20person&pageSize=10&page=2&sort=fullName&dir=asc' });
    expect(page1.json.data.users).toHaveLength(10);
    expect(page2.json.data.users).toHaveLength(2);
    expect(page1.json.data.users[0].fullName).toBe('Bulk Person 00');
    expect(page2.json.data.users[1].fullName).toBe('Bulk Person 11');
    const desc = await call('system/users', 'GET', { as: admin(), query: '?q=bulk%20person&sort=fullName&dir=desc&pageSize=10' });
    expect(desc.json.data.users[0].fullName).toBe('Bulk Person 11');

    const byRole = await call('system/users', 'GET', { as: admin(), query: '?role=LIBRARIAN&pageSize=100' });
    expect(byRole.json.data.users.every((u: { role: string }) => u.role === 'LIBRARIAN')).toBe(true);
    const bogus = await call('system/users', 'GET', { as: admin(), query: '?role=ROOT&sort=passwordHash&pageSize=7&page=abc' });
    expect(bogus.status).toBe(200);
    expect(bogus.json.data.pageSize).toBe(25);
    expect(bogus.json.data.page).toBe(1);
  });

  it('exports the filtered list as CSV, without secrets and safe for spreadsheets', async () => {
    await prisma.user.create({ data: { schoolId: A.schoolId, fullName: '=HYPERLINK("http://evil.test")', email: 'evil@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const r = await call('system/users', 'GET', { as: admin(), query: '?format=csv&q=evil' });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toContain('text/csv');
    expect(r.response.headers.get('content-disposition')).toContain('users.csv');
    expect(r.text.split('\r\n')[0]).toContain('Name,Email,Role,Status,Added');
    expect(r.text).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(r.text).not.toMatch(/passwordHash|password/i);
    expect(r.text.trim().split('\r\n')).toHaveLength(2);
  });

  it('edits name, email and role; a role change signs the user out and is audited', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: newId } });
    const n = await auditCount({ action: 'UPDATE_USER' });
    const r = await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: newId }, body: { fullName: 'Rudo Chari-Moyo', role: 'BURSAR' } });
    expect(r.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: newId } });
    expect(after).toMatchObject({ fullName: 'Rudo Chari-Moyo', role: 'BURSAR', email: 'rudo.chari@a.test' });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_USER', entityId: newId }, orderBy: { createdAt: 'desc' } });
    expect(entry.before).toMatchObject({ role: 'TEACHER' });
    expect(entry.after).toMatchObject({ role: 'BURSAR' });
    expect(await auditCount({ action: 'UPDATE_USER' })).toBe(n + 1);

    expect((await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: newId }, body: { email: A.users.HEAD.email } })).status).toBe(409);
    expect((await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: newId }, body: {} })).status).toBe(422);
    expect((await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: newId }, body: { role: 'OWNER' } })).status).toBe(422);
  });

  it('does not let you change your own role', async () => {
    const r = await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: admin().id }, body: { role: 'TEACHER' } });
    expect(r.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin().id } })).role).toBe('ADMIN');
  });

  it('deactivates and reactivates with audit rows; a deactivated user is signed out', async () => {
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: newId } })).tokenVersion;
    const r = await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: newId } });
    expect(r.status).toBe(200);
    const off = await prisma.user.findUniqueOrThrow({ where: { id: newId } });
    expect(off.active).toBe(false);
    expect(off.tokenVersion).toBe(v + 1);
    expect(await auditCount({ action: 'DEACTIVATE_USER', entityId: newId })).toBe(1);
    expect((await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: newId } })).status).toBe(409);

    expect((await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id: newId } })).status).toBe(409);

    expect((await call('system/users/[id]/reactivate', 'POST', { as: admin(), params: { id: newId } })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: newId } })).active).toBe(true);
    expect(await auditCount({ action: 'REACTIVATE_USER', entityId: newId })).toBe(1);
  });

  it('does not let you deactivate yourself', async () => {
    expect((await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id: admin().id } })).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin().id } })).active).toBe(true);
  });

  it('keeps at least one active administrator or owner', async () => {
    // HEAD is granted the right to deactivate people, purely through data.
    await prisma.rolePermission.createMany({ data: ['system.users.deactivate', 'system.users.update'].map((permission) => ({ schoolId: A.schoolId, role: 'HEAD' as const, permission })) });
    try {
      expect((await call('system/users/[id]/deactivate', 'POST', { as: A.users.HEAD, params: { id: admin().id } })).status).toBe(200);
      const last = await call('system/users/[id]/deactivate', 'POST', { as: A.users.HEAD, params: { id: owner().id } });
      expect(last.status).toBe(409);
      expect(last.json.message).toMatch(/at least one active administrator/);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner().id } })).active).toBe(true);
      const demote = await call('system/users/[id]', 'PATCH', { as: A.users.HEAD, params: { id: owner().id }, body: { role: 'TEACHER' } });
      expect(demote.status).toBe(409);
    } finally {
      await prisma.user.update({ where: { id: admin().id }, data: { active: true } });
      await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId } });
    }
  });

  it('resets a password: new one-time password, sessions ended, audited, no secrets in the log', async () => {
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: newId } })).tokenVersion;
    const r = await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id: newId } });
    expect(r.status).toBe(200);
    const pw: string = r.json.data.tempPassword;
    const row = await prisma.user.findUniqueOrThrow({ where: { id: newId } });
    expect(row.mustChangePassword).toBe(true);
    expect(row.tokenVersion).toBe(v + 1);
    expect(await auditCount({ action: 'RESET_PASSWORD', entityId: newId })).toBe(1);
    const logs = await prisma.auditLog.findMany({ where: { entityId: newId } });
    expect(JSON.stringify(logs)).not.toContain(pw);
    expect(JSON.stringify(logs)).not.toMatch(/passwordHash/);
  });

  it('cannot see or change a user of another school', async () => {
    const other = B.users.TEACHER.id;
    for (const [file, body] of [['system/users/[id]', { fullName: 'Taken Over' }], ['system/users/[id]/deactivate'], ['system/users/[id]/reactivate'], ['system/users/[id]/reset-password']] as const) {
      const r = await call(file, file === 'system/users/[id]' ? 'PATCH' : 'POST', { as: admin(), params: { id: other }, body });
      expect(r.status, file).toBe(404);
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id: other } });
    expect(row.active).toBe(true);
    expect(row.fullName).not.toBe('Taken Over');
  });
});

// ─── School settings ─────────────────────────────────────────────────────────

describe('school settings', () => {
  const good = { name: 'Chinhoyi High School', schoolType: 'PRIVATE', location: 'Chinhoyi', address: 'PO Box 1', phone: '+263 242 123456', email: 'Office@Chinhoyi.test', motto: 'Strive', logoUrl: 'https://utfs.io/f/logo.png', defaultCurrency: 'ZIG', maxClassSize: 40 };

  it('saves the profile with before/after in the audit log', async () => {
    const n = await auditCount({ action: 'UPDATE_SCHOOL_SETTINGS' });
    const r = await call('system/settings', 'PATCH', { as: admin(), body: good });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({ name: 'Chinhoyi High School', schoolType: 'PRIVATE', defaultCurrency: 'ZIG', maxClassSize: 40, email: 'office@chinhoyi.test' });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_SCHOOL_SETTINGS', schoolId: A.schoolId }, orderBy: { createdAt: 'desc' } });
    expect(entry.before).toMatchObject({ name: 'School A', defaultCurrency: 'USD' });
    expect(entry.after).toMatchObject({ name: 'Chinhoyi High School', defaultCurrency: 'ZIG' });
    expect(await auditCount({ action: 'UPDATE_SCHOOL_SETTINGS' })).toBe(n + 1);
    expect((await call('system/settings', 'GET', { as: owner() })).json.data.school.name).toBe('Chinhoyi High School');
  });

  it("never touches another school", async () => {
    expect((await prisma.school.findUniqueOrThrow({ where: { id: B.schoolId } })).name).toBe('School B');
    expect((await call('system/settings', 'GET', { as: B.users.ADMIN })).json.data.school.name).toBe('School B');
  });

  it('rejects bad input without changing anything', async () => {
    for (const bad of [{ name: '' }, { schoolType: 'ACADEMY' }, { defaultCurrency: 'GBP' }, { maxClassSize: 0 }, { maxClassSize: '40' }, { email: 'nope' }, { phone: 'abc' }, { logoUrl: 'https://evil.test/x.png' }]) {
      const r = await call('system/settings', 'PATCH', { as: admin(), body: { ...good, ...bad } });
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name).toBe('Chinhoyi High School');
  });

  it('is rolled back when the audit write fails', async () => {
    audit.failNext = true;
    const r = await call('system/settings', 'PATCH', { as: admin(), body: { ...good, name: 'Should Not Stick' } });
    expect(r.status).toBe(500);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name).toBe('Chinhoyi High School');
  });

  it('turns blanks into empty values', async () => {
    const r = await call('system/settings', 'PATCH', { as: admin(), body: { ...good, motto: '', phone: '', logoUrl: '' } });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({ motto: null, phone: null, logoUrl: null });
  });
});

// ─── Calendar ────────────────────────────────────────────────────────────────

describe('calendar', () => {
  let id: string;
  const ev = { title: 'Mock exams', kind: 'EXAM', startDate: '2026-08-24', endDate: '2026-08-25', notes: 'Bring pens' };

  it('adds an event and shows it with the term dates and the public holidays', async () => {
    await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-01&to=2026-08-31' }); // loads 2026's holidays once
    const n = await auditCount({ action: 'CREATE_CALENDAR_EVENT' });
    const r = await call('system/calendar', 'POST', { as: admin(), body: ev });
    expect(r.status).toBe(201);
    id = r.json.data.event.id;
    expect(await auditCount({ action: 'CREATE_CALENDAR_EVENT' })).toBe(n + 1);

    const list = await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-01&to=2026-12-31' });
    const items = list.json.data.items as { source: string; title: string; kind: string }[];
    expect(items.filter((i) => i.source === 'event' && i.kind === 'EXAM').map((i) => i.title)).toEqual(['Mock exams']);
    expect(items.some((i) => i.source === 'term' && i.title === 'Term 1 2026 ends')).toBe(true);
    expect(items.some((i) => i.kind === 'PUBLIC_HOLIDAY' && i.title === "Heroes' Day")).toBe(true);
  });

  it('shows an event only on the days it overlaps', async () => {
    const inside = await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-25&to=2026-08-30' });
    expect(inside.json.data.items.some((i: { id: string }) => i.id === id)).toBe(true);
    const outside = await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-26&to=2026-08-30' });
    expect(outside.json.data.items.some((i: { id: string }) => i.id === id)).toBe(false);
    expect((await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-12&to=2026-08-01' })).status).toBe(422);
    expect((await call('system/calendar', 'GET', { as: admin(), query: '?from=yesterday' })).status).toBe(422);
    expect((await call('system/calendar', 'GET', { as: admin(), query: '?type=PARTY' })).status).toBe(422);
  });

  it('edits and deletes with audit rows', async () => {
    const r = await call('system/calendar/[id]', 'PATCH', { as: admin(), params: { id }, body: { ...ev, title: 'Mock and trial exams', endDate: '2026-08-26' } });
    expect(r.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_CALENDAR_EVENT', entityId: id } });
    expect(entry.before).toMatchObject({ title: 'Mock exams', endDate: '2026-08-25' });
    expect(entry.after).toMatchObject({ title: 'Mock and trial exams', endDate: '2026-08-26' });

    const del = await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id } });
    expect(del.status).toBe(200);
    expect(await prisma.calendarEvent.count({ where: { id } })).toBe(0);
    expect(await auditCount({ action: 'DELETE_CALENDAR_EVENT', entityId: id })).toBe(1);
    expect((await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id } })).status).toBe(404);
  });

  it('rejects bad events', async () => {
    for (const bad of [{ title: '' }, { title: 'x'.repeat(121) }, { kind: 'PARTY' }, { kind: 'TERM' }, { endDate: '2026-08-23' }, { startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: 'soon' }]) {
      expect((await call('system/calendar', 'POST', { as: admin(), body: { ...ev, ...bad } })).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('keeps schools apart', async () => {
    const mine = (await call('system/calendar', 'POST', { as: admin(), body: ev })).json.data.event.id;
    const theirs = (await call('system/calendar', 'POST', { as: B.users.ADMIN, body: { ...ev, title: 'B only' } })).json.data.event.id;
    const listA = await call('system/calendar', 'GET', { as: admin(), query: '?from=2026-08-01&to=2026-08-31' });
    expect(listA.json.data.items.map((i: { title: string }) => i.title)).not.toContain('B only');
    expect((await call('system/calendar/[id]', 'PATCH', { as: admin(), params: { id: theirs }, body: ev })).status).toBe(404);
    expect((await call('system/calendar/[id]', 'DELETE', { as: admin(), params: { id: theirs } })).status).toBe(404);
    expect(await prisma.calendarEvent.count({ where: { id: theirs } })).toBe(1);
    expect(await prisma.calendarEvent.count({ where: { id: mine } })).toBe(1);
  });

  it('is rolled back when the audit write fails', async () => {
    const n = await prisma.calendarEvent.count({ where: { schoolId: A.schoolId } });
    audit.failNext = true;
    expect((await call('system/calendar', 'POST', { as: admin(), body: { ...ev, title: 'Ghost' } })).status).toBe(500);
    expect(await prisma.calendarEvent.count({ where: { schoolId: A.schoolId } })).toBe(n);
  });
});

// ─── Modules and subscription ────────────────────────────────────────────────

describe('module switches', () => {
  it('start with every module on', async () => {
    const r = await call('system/subscription/modules', 'GET', { as: admin() });
    expect(Object.values(r.json.data.modules).every(Boolean)).toBe(true);
    expect(Object.keys(r.json.data.modules)).toHaveLength(8);
  });

  it('switching a module off makes can() refuse its keys — even for the administrator — and hides its group', async () => {
    const { requirePermission, getAccess } = await import('@/lib/access');
    const { buildNav } = await import('@/lib/nav');
    session.current = { ...admin() };
    await expect(requirePermission('finance.payments.view')).resolves.toMatchObject({ id: admin().id });

    const n = await auditCount({ action: 'UPDATE_SCHOOL_MODULES' });
    const r = await call('system/subscription/modules', 'PATCH', { as: admin(), body: { modules: { finance: false, hr: false } } });
    expect(r.status).toBe(200);
    expect(r.json.data.modules).toMatchObject({ finance: false, hr: false, system: true, students: true });
    expect(await auditCount({ action: 'UPDATE_SCHOOL_MODULES' })).toBe(n + 1);

    session.current = { ...admin() };
    await expect(requirePermission('finance.payments.view')).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission('hr.staff.view')).rejects.toMatchObject({ status: 403 });
    await expect(requirePermission('students.list.view')).resolves.toBeTruthy();
    await expect(requirePermission('system.users.view')).resolves.toBeTruthy();

    const { user, can } = await getAccess();
    expect(can('finance.payments.view')).toBe(false);
    expect(buildNav(user).map((g) => g.module)).not.toContain('finance');
    expect(buildNav(user).map((g) => g.module)).toContain('students');

    // School B is untouched.
    session.current = { ...B.users.ADMIN };
    await expect(requirePermission('finance.payments.view')).resolves.toBeTruthy();

    // Back on.
    const back = await call('system/subscription/modules', 'PATCH', { as: admin(), body: { modules: { finance: true, hr: true } } });
    expect(back.status).toBe(200);
    session.current = { ...admin() };
    await expect(requirePermission('finance.payments.view')).resolves.toBeTruthy();
  });

  it('refuses to switch System off, unknown modules, and does nothing for a repeat', async () => {
    for (const modules of [{ system: false }, { payroll: false }]) {
      expect((await call('system/subscription/modules', 'PATCH', { as: admin(), body: { modules } })).status).toBe(422);
    }
    expect((await call('system/subscription/modules', 'PATCH', { as: admin(), body: {} })).status).toBe(422);
    const n = await auditCount({ action: 'UPDATE_SCHOOL_MODULES' });
    expect((await call('system/subscription/modules', 'PATCH', { as: admin(), body: { modules: { finance: true } } })).status).toBe(200);
    expect(await auditCount({ action: 'UPDATE_SCHOOL_MODULES' })).toBe(n);
  });

  it('the database itself refuses a System switch-off', async () => {
    await expect(prisma.schoolModule.create({ data: { schoolId: A.schoolId, module: 'system', enabled: false } })).rejects.toThrow();
  });

  it('is rolled back when the audit write fails', async () => {
    audit.failNext = true;
    expect((await call('system/subscription/modules', 'PATCH', { as: admin(), body: { modules: { communication: false } } })).status).toBe(500);
    const r = await call('system/subscription/modules', 'GET', { as: admin() });
    expect(r.json.data.modules.communication).toBe(true);
  });
});

// ─── Term switcher ───────────────────────────────────────────────────────────

describe('term switcher', () => {
  let otherTermId: string;
  beforeAll(async () => {
    const t2 = await prisma.academicTerm.create({
      data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2026-04-20'), endDate: new Date('2026-08-20'), status: 'PLANNED' },
    });
    otherTermId = t2.id;
  });

  it('remembers the chosen term in a cookie and never changes which term is open', async () => {
    const r = await call('system/view-term', 'POST', { as: admin(), body: { termId: otherTermId } });
    expect(r.status).toBe(200);
    const cookie = r.response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`pfuma_term=${otherTermId}`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    const terms = await prisma.academicTerm.findMany({ where: { schoolId: A.schoolId }, orderBy: { termNumber: 'asc' } });
    expect(terms.map((x) => x.status)).toEqual(['OPEN', 'PLANNED']);
    expect(await auditCount({ action: 'OPEN_TERM' })).toBe(0);
  });

  it('works for every signed-in role (it only changes what you look at)', async () => {
    for (const role of ROLES) expect((await call('system/view-term', 'POST', { as: A.users[role], body: { termId: A.termId } })).status, role).toBe(200);
    expect((await call('system/view-term', 'POST', { as: null, body: { termId: A.termId } })).status).toBe(401);
  });

  it("refuses another school's term, an unknown term and bad input", async () => {
    expect((await call('system/view-term', 'POST', { as: admin(), body: { termId: B.termId } })).status).toBe(404);
    expect((await call('system/view-term', 'POST', { as: admin(), body: { termId: 'nope' } })).status).toBe(404);
    expect((await call('system/view-term', 'POST', { as: admin(), body: {} })).status).toBe(422);
  });

  it('changes which term the dashboard figures describe', async () => {
    const { getDashboardData } = await import('@/lib/system/dashboard');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const db = getScopedDb(A.schoolId, admin().id);
    const t1 = await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } });
    const t2 = await prisma.academicTerm.findUniqueOrThrow({ where: { id: otherTermId } });

    await prisma.payment.update({ where: { id: A.paymentId }, data: { status: 'VERIFIED', verifiedBy: owner().id, verifiedAt: new Date('2026-05-15') } });
    try {
      const d1 = await getDashboardData(db, A.schoolId, t1, { finance: true, audit: false, now: new Date('2026-05-20') });
      const d2 = await getDashboardData(db, A.schoolId, t2, { finance: true, audit: false, now: new Date('2026-05-20') });
      expect(d1.enrolled).toBe(1);   // the seeded student is enrolled in Term 1 only
      expect(d2.enrolled).toBe(0);
      expect(d1.billed.USD).toBe(100);
      expect(d2.billed.USD).toBe(0);
      expect(d1.collected.USD).toBe(50); // 15 May falls inside both windows, so both see it…
      expect(d2.collected.USD).toBe(50);
      const d3 = await getDashboardData(db, A.schoolId, { ...t2, startDate: new Date('2026-09-01'), endDate: new Date('2026-12-01') }, { finance: true, audit: false, now: new Date('2026-05-20') });
      expect(d3.collected.USD).toBe(0); // …but a term in September does not
      expect(d1.progress?.state).toBe('running');
    } finally {
      await prisma.payment.update({ where: { id: A.paymentId }, data: { status: 'PENDING', verifiedBy: null, verifiedAt: null } });
    }
  });

  it('leaves finance and audit figures out when the viewer may not see them', async () => {
    const { getDashboardData } = await import('@/lib/system/dashboard');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const t1 = await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } });
    const d = await getDashboardData(getScopedDb(A.schoolId, admin().id), A.schoolId, t1, { finance: false, audit: false });
    expect(d).toMatchObject({ billed: { USD: 0, ZIG: 0 }, collected: { USD: 0, ZIG: 0 }, pendingPayments: 0, recent: [] });
  });

  it("counts only this school's figures", async () => {
    const { getDashboardData } = await import('@/lib/system/dashboard');
    const { getScopedDb } = await import('@/lib/scoped-db');
    const t1 = await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } });
    const d = await getDashboardData(getScopedDb(A.schoolId, admin().id), A.schoolId, t1, { finance: true, audit: true });
    expect(d.pendingPayments).toBe(1);
    expect(d.staff).toBe(await prisma.user.count({ where: { schoolId: A.schoolId, active: true } }));
    expect(d.recent.every((r) => r.action !== 'DATA_CREATE')).toBe(true);
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe('notifications', () => {
  beforeAll(async () => {
    await prisma.notification.createMany({
      data: [
        { schoolId: A.schoolId, userId: A.users.HEAD.id, title: 'For head 1' },
        { schoolId: A.schoolId, userId: A.users.HEAD.id, title: 'For head 2' },
        { schoolId: A.schoolId, userId: A.users.BURSAR.id, title: 'For bursar' },
        { schoolId: B.schoolId, userId: B.users.HEAD.id, title: 'For other head' },
      ],
    });
  });

  it('shows each person only their own, with an unread count, for every role', async () => {
    const r = await call('system/notifications', 'GET', { as: A.users.HEAD });
    expect(r.status).toBe(200);
    expect(r.json.data.unread).toBe(2);
    expect(r.json.data.items.map((n: { title: string }) => n.title).sort()).toEqual(['For head 1', 'For head 2']);
    expect((await call('system/notifications', 'GET', { as: A.users.BURSAR })).json.data.items.map((n: { title: string }) => n.title)).toEqual(['For bursar']);
    expect((await call('system/notifications', 'GET', { as: null })).status).toBe(401);
  });

  it('marks one read, and never one that belongs to someone else', async () => {
    const mine = await prisma.notification.findFirstOrThrow({ where: { userId: A.users.HEAD.id, title: 'For head 1' } });
    const bursars = await prisma.notification.findFirstOrThrow({ where: { userId: A.users.BURSAR.id } });
    expect((await call('system/notifications', 'POST', { as: A.users.HEAD, body: { id: bursars.id } })).status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: bursars.id } })).readAt).toBeNull();
    expect((await call('system/notifications', 'POST', { as: A.users.HEAD, body: { id: mine.id } })).status).toBe(200);
    expect((await call('system/notifications', 'GET', { as: A.users.HEAD })).json.data.unread).toBe(1);
  });

  it('marks all read for the caller only', async () => {
    expect((await call('system/notifications', 'POST', { as: A.users.HEAD, body: { all: true } })).status).toBe(200);
    expect((await call('system/notifications', 'GET', { as: A.users.HEAD })).json.data.unread).toBe(0);
    expect((await call('system/notifications', 'GET', { as: A.users.BURSAR })).json.data.unread).toBe(1);
    expect((await call('system/notifications', 'GET', { as: B.users.HEAD })).json.data.unread).toBe(1);
    expect((await call('system/notifications', 'POST', { as: A.users.HEAD, body: { all: false } })).status).toBe(422);
  });
});

// ─── Audit log ───────────────────────────────────────────────────────────────

describe('audit log', () => {
  it('shows this school only', async () => {
    await prisma.auditLog.create({ data: { schoolId: B.schoolId, actorId: B.users.ADMIN.id, action: 'UPDATE_USER', entityType: 'User', entityId: 'x', detail: 'B-secret-detail' } });
    const r = await call('system/audit-log', 'GET', { as: admin(), query: '?pageSize=100' });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain('B-secret-detail');
    expect(r.json.data.total).toBe(await prisma.auditLog.count({ where: { schoolId: A.schoolId } }));
  });

  it('filters by action, person, record type and dates; searches; sorts; pages', async () => {
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: A.users.BURSAR.id, action: 'RECORD_PAYMENT', entityType: 'Payment', entityId: 'pay-1', detail: 'Receipt R-0001' } });
    const get = async (q: string) => (await call('system/audit-log', 'GET', { as: admin(), query: q })).json.data;

    const byAction = await get('?action=RECORD_PAYMENT&pageSize=100');
    expect(byAction.entries.length).toBeGreaterThanOrEqual(1);
    expect(byAction.entries.every((e: { action: string }) => e.action === 'RECORD_PAYMENT')).toBe(true);

    expect((await get(`?actor=${A.users.BURSAR.id}&action=RECORD_PAYMENT`)).total).toBe(byAction.total);
    expect((await get(`?actor=${A.users.TEACHER.id}&action=RECORD_PAYMENT`)).total).toBe(0);
    expect((await get('?entity=Payment&action=RECORD_PAYMENT')).total).toBe(byAction.total);
    expect((await get('?q=R-0001')).total).toBe(1);
    expect((await get('?q=pay-1')).total).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`?from=${today}&to=${today}&action=RECORD_PAYMENT`)).total).toBe(byAction.total);
    expect((await get('?from=2020-01-01&to=2020-01-31')).total).toBe(0);

    const asc = await get('?sort=createdAt&dir=asc&pageSize=10');
    const desc = await get('?sort=createdAt&dir=desc&pageSize=10');
    expect(new Date(asc.entries[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(asc.entries.at(-1).createdAt).getTime());
    expect(new Date(desc.entries[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(desc.entries.at(-1).createdAt).getTime());

    const p1 = await get('?pageSize=10&page=1');
    const p2 = await get('?pageSize=10&page=2');
    expect(p1.entries).toHaveLength(10);
    expect(p1.entries.map((e: { id: string }) => e.id)).not.toEqual(expect.arrayContaining([p2.entries[0].id]));
    expect((await get('?sort=actor&dir=asc&pageSize=10')).entries).toHaveLength(10);
    // Bad values fall back to defaults rather than failing.
    expect((await call('system/audit-log', 'GET', { as: admin(), query: '?action=drop%20table&from=never&sort=detail;--' })).status).toBe(200);
  });

  it('exports the same filtered rows as CSV, safe for spreadsheets', async () => {
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'UPDATE_SCHOOL_SETTINGS', entityType: 'School', entityId: A.schoolId, detail: '=cmd|calc' } });
    const r = await call('system/audit-log', 'GET', { as: admin(), query: '?format=csv&action=UPDATE_SCHOOL_SETTINGS' });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toContain('text/csv');
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('When,Who,Action,Record type,Record ID,Detail');
    expect(r.text).toContain("'=cmd|calc");
    const json = await call('system/audit-log', 'GET', { as: admin(), query: '?action=UPDATE_SCHOOL_SETTINGS' });
    expect(lines.length - 1).toBe(json.json.data.total);
  });

  it('cannot be edited or deleted', async () => {
    await expect(prisma.auditLog.deleteMany({ where: { schoolId: A.schoolId } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(prisma.auditLog.updateMany({ where: { schoolId: A.schoolId }, data: { detail: 'x' } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it('records row-level history of calendar events and module switches', async () => {
    const n = await prisma.auditLog.count({ where: { schoolId: A.schoolId, entityType: 'CalendarEvent', action: 'DATA_CREATE' } });
    await call('system/calendar', 'POST', { as: admin(), body: { title: 'Trigger check', kind: 'OTHER', startDate: '2026-09-01', endDate: '2026-09-01' } });
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, entityType: 'CalendarEvent', action: 'DATA_CREATE' } })).toBe(n + 1);
  });
});

// ─── Profile ─────────────────────────────────────────────────────────────────

describe('my profile', () => {
  it('lets any signed-in user change their own name, audited', async () => {
    const n = await auditCount({ action: 'UPDATE_USER', entityId: A.users.TEACHER.id });
    const r = await call('system/profile', 'PATCH', { as: A.users.TEACHER, body: { fullName: ' Tendai T. Moyo ' } });
    expect(r.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: A.users.TEACHER.id } })).fullName).toBe('Tendai T. Moyo');
    expect(await auditCount({ action: 'UPDATE_USER', entityId: A.users.TEACHER.id })).toBeGreaterThan(n);
  });

  it('cannot be used to change email or role, or by a stranger', async () => {
    const r = await call('system/profile', 'PATCH', { as: A.users.TEACHER, body: { fullName: 'Same Person', role: 'ADMIN', email: 'x@y.zw' } });
    expect(r.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: A.users.TEACHER.id } });
    expect(row.role).toBe('TEACHER');
    expect(row.email).toBe(A.users.TEACHER.email);
    expect((await call('system/profile', 'PATCH', { as: A.users.TEACHER, body: { fullName: 'x' } })).status).toBe(422);
    expect((await call('system/profile', 'PATCH', { as: null, body: { fullName: 'Someone' } })).status).toBe(401);
  });
});
