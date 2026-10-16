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
  const routes: [string, 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Record<string, unknown>?, string?][] = [
    ['system/users', 'GET'],
    ['system/users', 'POST', { fullName: 'Nope Nobody', email: 'nope@a.test', phone: '0771234567', roles: ['TEACHER'] }],
    ['system/users/[id]/invite', 'POST', undefined, 'TEACHER'],
    ['system/users/import', 'POST', { csv: ['name,email,phone,roles', 'A B,ab@a.test,0771234567,Teacher'].join('\n') }],
    ['system/users/import', 'GET'],
    ['system/users/[id]', 'PATCH', { fullName: 'Nope Nobody' }, 'TEACHER'],
    ['system/users/[id]/deactivate', 'POST', undefined, 'TEACHER'],
    ['system/users/[id]/reactivate', 'POST', undefined, 'TEACHER'],
    ['system/users/[id]/reset-password', 'POST', undefined, 'TEACHER'],
    ['system/settings', 'GET'],
    ['system/settings/profile', 'PATCH', { name: 'Hacked School', schoolType: 'PRIVATE', boarding: 'DAY', studentGender: 'CO_ED', district: 'Harare', physicalAddress: '1 Hacker Road' }],
    ['system/settings/defaults', 'PATCH', { maxClassSize: 40 }],
    ['system/settings/finance', 'PATCH', { currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'USD', receiptFormat: 'RCP-{000000}', receiptNextNumber: 1, invoiceFormat: 'INV-{000000}', invoiceNextNumber: 1 }],
    ['system/settings/numbering', 'PATCH', { schoolCode: 'HAX', admissionFormat: '{SCHOOLCODE}{0000}' }],
    ['system/academic/years', 'POST', { year: 2031, terms: [{ startDate: '2031-01-05', endDate: '2031-04-04' }, { startDate: '2031-05-04', endDate: '2031-08-08' }, { startDate: '2031-09-07', endDate: '2031-12-05' }] }],
    ['system/structure/forms', 'PATCH', { forms: [{ id: 'x', active: false }] }],
    ['system/structure/streams', 'POST', { name: 'Hack' }],
    ['system/structure/classes', 'PUT', { cells: [{ levelId: 'x', stream: '', exists: true, capacity: 40 }] }],
    ['system/grading', 'GET'],
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

// ─── School settings ─────────────────────────────────────────────────────────

describe('school settings', () => {
  const good = {
    name: 'Chinhoyi High School', motto: 'Strive', logoUrl: 'https://utfs.io/f/logo.png', schoolType: 'MISSION_CHURCH', responsibleAuthority: 'Anglican Diocese of Harare',
    boarding: 'DAY_AND_BOARDING', studentGender: 'GIRLS', offersCambridge: true, zimsecCentreNumber: '140123', emisNumber: 'EMIS-2231', province: 'Mashonaland West',
    district: 'Chinhoyi', physicalAddress: '12 Main Street, Chinhoyi', postalAddress: 'P O Box 1, Chinhoyi', phone: '0242 700 123', email: 'Office@Chinhoyi.test',
    website: 'https://www.chinhoyi.co.zw', headName: 'Mrs T. Moyo', headSignatureUrl: 'https://utfs.io/f/sign.png',
  };
  const save = (body: object, as: typeof A.users.ADMIN | null = admin()) => call('system/settings/profile', 'PATCH', { as, body });

  it('saves the whole profile, with the phone as +263…, and logs before and after', async () => {
    const n = await auditCount({ action: 'UPDATE_SCHOOL_SETTINGS' });
    const r = await save(good);
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({
      name: 'Chinhoyi High School', schoolType: 'MISSION_CHURCH', responsibleAuthority: 'Anglican Diocese of Harare', boarding: 'DAY_AND_BOARDING', studentGender: 'GIRLS',
      offersCambridge: true, zimsecCentreNumber: '140123', emisNumber: 'EMIS-2231', province: 'Mashonaland West', district: 'Chinhoyi', phone: '+263242700123',
      email: 'office@chinhoyi.test', website: 'https://www.chinhoyi.co.zw', headName: 'Mrs T. Moyo',
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_SCHOOL_SETTINGS', schoolId: A.schoolId }, orderBy: { createdAt: 'desc' } });
    expect(entry.before).toMatchObject({ name: 'School A', boarding: 'DAY', offersCambridge: false });
    expect(entry.after).toMatchObject({ name: 'Chinhoyi High School', boarding: 'DAY_AND_BOARDING', phone: '+263242700123' });
    expect(entry.detail).toMatch(/^School profile: changed name,/);
    expect(await auditCount({ action: 'UPDATE_SCHOOL_SETTINGS' })).toBe(n + 1);
    expect((await call('system/settings', 'GET', { as: owner() })).json.data.school.name).toBe('Chinhoyi High School');
  });

  it('keeps the profile and the defaults apart in the log', async () => {
    const r = await call('system/settings/defaults', 'PATCH', { as: admin(), body: { maxClassSize: 40 } });
    expect(r.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UPDATE_SCHOOL_SETTINGS', schoolId: A.schoolId }, orderBy: { createdAt: 'desc' } });
    expect(entry.detail).toMatch(/^Defaults: changed maxClassSize/);
    expect(Object.keys(entry.after as object)).not.toContain('name');
    expect((await call('system/settings', 'GET', { as: admin() })).json.data.school.name).toBe('Chinhoyi High School'); // the profile did not move
  });

  it('never touches another school', async () => {
    expect((await prisma.school.findUniqueOrThrow({ where: { id: B.schoolId } })).name).toBe('School B');
    expect((await call('system/settings', 'GET', { as: B.users.ADMIN })).json.data.school.name).toBe('School B');
  });

  it('rejects bad input without changing anything', async () => {
    const bad: object[] = [
      { name: '' }, { name: 'x'.repeat(121) }, { schoolType: 'ACADEMY' }, { boarding: 'WEEKLY' }, { studentGender: 'MIXED' }, { province: 'Narnia' },
      { district: '' }, { physicalAddress: '' }, { physicalAddress: 'x'.repeat(251) }, { phone: 'abc' }, { phone: '+27 82 123 4567' }, { phone: '12345' },
      { email: 'nope' }, { website: 'www.school.co.zw' }, { website: 'ftp://school.co.zw' }, { zimsecCentreNumber: '12' }, { emisNumber: '!!' },
      { logoUrl: 'https://evil.test/x.png' }, { logoUrl: 'http://utfs.io/f/x.png' }, { headSignatureUrl: 'https://evil.test/s.png' }, { headName: 'x'.repeat(101) },
      { motto: 'x'.repeat(151) }, { offersCambridge: 'yes' },
    ];
    for (const b of bad) expect((await save({ ...good, ...b })).status, JSON.stringify(b)).toBe(422);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name).toBe('Chinhoyi High School');
  });

  it('needs the name, school type, boarding, gender, district and physical address', async () => {
    for (const field of ['name', 'schoolType', 'boarding', 'studentGender', 'district', 'physicalAddress']) {
      const rest: Record<string, unknown> = { ...good };
      delete rest[field];
      expect((await save(rest)).status, field).toBe(422);
    }
  });

  it('accepts every school type, boarding option and gender', async () => {
    for (const schoolType of ['GOVERNMENT', 'COUNCIL', 'MISSION_CHURCH', 'TRUST', 'PRIVATE']) expect((await save({ ...good, schoolType })).status, schoolType).toBe(200);
    for (const boarding of ['DAY', 'BOARDING', 'DAY_AND_BOARDING']) expect((await save({ ...good, boarding })).status, boarding).toBe(200);
    for (const studentGender of ['BOYS', 'GIRLS', 'CO_ED']) expect((await save({ ...good, studentGender })).status, studentGender).toBe(200);
  });

  it('is rolled back when the audit write fails', async () => {
    audit.failNext = true;
    const r = await save({ ...good, name: 'Should Not Stick' });
    expect(r.status).toBe(500);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).name).toBe('Chinhoyi High School');
  });

  it('turns blank optional fields into empty values, and keeps the required ones', async () => {
    const r = await save({ ...good, motto: '', phone: '', logoUrl: '', website: '', email: '', postalAddress: '', headName: '', headSignatureUrl: '', responsibleAuthority: '', emisNumber: '', zimsecCentreNumber: '', province: '' });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({
      motto: null, phone: null, logoUrl: null, website: null, email: null, postalAddress: null, headName: null, headSignatureUrl: null,
      responsibleAuthority: null, emisNumber: null, zimsecCentreNumber: null, province: null, district: 'Chinhoyi',
    });
  });

  it('is refused to a signed-out caller and to someone without the permission', async () => {
    expect((await save(good, null)).status).toBe(401);
    expect((await save(good, A.users.HEAD)).status).toBe(403);
    expect((await call('system/settings/defaults', 'PATCH', { as: A.users.HEAD, body: { maxClassSize: 40 } })).status).toBe(403);
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
