// @vitest-environment node
// Roles and permissions as data, the audit log (columns, filters, request details, who can change it),
// notifications (the helper, the bell, welcome, scheduled), and my profile.
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, revokePermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  auth: (await import('../helpers/session')).mockAuth,
}));

// What the caller sent, for the audit log's address and browser columns.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({
  headers: () => req.headers,
  cookies: () => ({ get: () => undefined, set: () => undefined, getAll: () => [] }),
}));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

const admin = () => A.users.ADMIN;
const ROLE_KEYS = ['OWNER', 'HEAD', 'DEPUTY_HEAD', 'ADMINISTRATOR', 'BURSAR', 'ACCOUNTS_CLERK', 'HR_OFFICER', 'HOD', 'TEACHER', 'CLASS_TEACHER', 'EXAMS_OFFICER', 'LIBRARIAN', 'BOARDING_MASTER'];
const SYSTEM_PERMISSIONS = [
  'system.dashboard.view', 'system.calendar.view', 'system.calendar.create', 'system.calendar.edit', 'system.calendar.delete', 'system.calendar.export',
  'system.settings.view', 'system.settings.edit', 'system.users.view', 'system.users.create', 'system.users.edit', 'system.users.deactivate', 'system.users.export',
  'system.roles.view', 'system.roles.edit', 'system.audit.view', 'system.audit.export', 'system.subscription.view',
];

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

beforeEach(async () => {
  req.headers = new Headers();
  (await import('@/lib/rate-limit'))._resetRateLimitForTests();
});

const render = async (user: object, mod: string, props: object = {}) => {
  session.current = { ...user };
  const page = (await import(/* @vite-ignore */ mod)).default as (p: object) => Promise<React.ReactElement>;
  return page(props);
};

// ─── Roles and permissions ───────────────────────────────────────────────────

describe('roles and permissions as data', () => {
  it('gives every school the 13 system roles, each with a name and a one-line description', async () => {
    for (const s of [A, B]) {
      const roles = await prisma.roleDefinition.findMany({ where: { schoolId: s.schoolId } });
      expect(roles.map((r) => r.key).sort()).toEqual([...ROLE_KEYS].sort());
      for (const r of roles) {
        expect(r.isSystem, r.key).toBe(true);
        expect(r.name.length, r.key).toBeGreaterThan(2);
        expect(r.description.length, r.key).toBeGreaterThan(10);
        expect(r.description, r.key).not.toContain('\n');
      }
    }
  });

  it('knows every permission key, as module.page.action, and the wildcard', async () => {
    const keys = (await prisma.permission.findMany()).map((p) => p.key);
    for (const k of SYSTEM_PERMISSIONS) expect(keys, k).toContain(k);
    expect(keys).toContain('*');
    for (const k of keys.filter((x) => x !== '*')) expect(k).toMatch(/^[a-z]+\.[a-z_]+\.[a-z_]+$|^[a-z]+\.[a-z]+$/);
    expect((await prisma.permission.findMany({ where: { key: { in: SYSTEM_PERMISSIONS } } })).every((p) => p.module === 'system')).toBe(true);
  });

  it('grants Owner and Administrator everything, every role the dashboard and the calendar, and nothing else', async () => {
    const roles = await prisma.roleDefinition.findMany({ where: { schoolId: A.schoolId }, include: { permissions: true } });
    for (const r of roles) {
      const keys = r.permissions.map((p) => p.permissionKey).sort();
      if (r.key === 'OWNER' || r.key === 'ADMINISTRATOR') expect(keys, r.key).toEqual(['*', 'system.calendar.view', 'system.dashboard.view']);
      else {
        // Teachers and class teachers also hold the own-class keys of Academics (the code narrows them to their own classes).
        const own = r.key === 'TEACHER'
          ? ['academics.assignments.view', 'academics.attendance.mark', 'academics.classes.view', 'academics.schemes.edit', 'academics.schemes.view', 'academics.subjects.view', 'academics.timetable.view']
          : r.key === 'CLASS_TEACHER'
            ? ['academics.attendance.mark', 'academics.attendance.view', 'academics.classes.view', 'academics.subjects.view', 'academics.timetable.view']
            : [];
        // Examinations keys each role starts with (exams_role_keys in the migration).
        const exams: Record<string, string[]> = {
          TEACHER: ['exams.analytics.view', 'exams.assessments.create', 'exams.comments.subject', 'exams.marks.enter', 'exams.marks.submit'],
          CLASS_TEACHER: ['exams.analytics.view', 'exams.comments.class', 'exams.results.view'],
          HOD: ['exams.analytics.view', 'exams.marks.verify', 'exams.marks.view', 'exams.results.view'],
          HEAD: ['exams.analytics.view', 'exams.comments.head', 'exams.marks.unlock', 'exams.marks.view', 'exams.projects.manage', 'exams.reportcards.settings', 'exams.results.publish', 'exams.results.unpublish', 'exams.results.view', 'exams.setup.manage', 'exams.zimsec.approve'],
          DEPUTY_HEAD: ['exams.analytics.view', 'exams.marks.view', 'exams.results.view', 'exams.timetable.approve'],
          EXAMS_OFFICER: ['exams.analytics.view', 'exams.invigilation.manage', 'exams.marks.view', 'exams.projects.manage', 'exams.results.view', 'exams.setup.manage', 'exams.timetable.manage', 'exams.zimsec.manage', 'exams.zimsec.results_import'],
        };
        // Finance keys each role starts with (finance_role_keys in the migration): everyone who can ask for spending, and the finance people.
        const raise = ['finance.requests.create'];
        const finance: Record<string, string[]> = {
          TEACHER: raise, CLASS_TEACHER: raise, HOD: raise, EXAMS_OFFICER: raise, LIBRARIAN: raise, HR_OFFICER: raise, BOARDING_MASTER: raise,
          DEPUTY_HEAD: ['finance.fees.view', 'finance.requests.create'],
          ACCOUNTS_CLERK: ['finance.accounts.view', 'finance.fees.view', 'finance.payments.record', 'finance.payments.view', 'finance.requests.create', 'finance.requests.view'],
          HEAD: ['finance.accounts.view', 'finance.adjustments.approve', 'finance.expenses.view', 'finance.fees.view', 'finance.funds.manage', 'finance.payments.verify', 'finance.payments.view', 'finance.rates.view',
            'finance.refunds.approve', 'finance.reports.export', 'finance.reports.view', 'finance.requests.approve', 'finance.requests.create', 'finance.requests.view'],
          BURSAR: ['finance.accounts.view', 'finance.adjustments.create', 'finance.charges.create', 'finance.expenses.record', 'finance.expenses.view', 'finance.fees.manage', 'finance.fees.view', 'finance.payments.record',
            'finance.payments.verify', 'finance.payments.view', 'finance.rates.view', 'finance.refunds.pay', 'finance.refunds.request', 'finance.reports.export', 'finance.reports.view', 'finance.requests.create',
            'finance.requests.disburse', 'finance.requests.view'],
        };
        expect(keys, r.key).toEqual([...own, ...(exams[r.key] ?? []), ...(finance[r.key] ?? []), 'system.calendar.view', 'system.dashboard.view'].sort());
      }
    }
  });

  it('cannot delete or re-key a system role, but a name can be changed', async () => {
    const teacher = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'TEACHER' } });
    await expect(prisma.roleDefinition.delete({ where: { id: teacher.id } })).rejects.toThrow(/cannot be deleted/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    await expect(prisma.roleDefinition.update({ where: { id: teacher.id }, data: { key: 'SOMETHING' } })).rejects.toThrow(/cannot be changed/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    await expect(prisma.roleDefinition.update({ where: { id: teacher.id }, data: { isSystem: false } })).rejects.toThrow(/cannot be changed/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    await expect(prisma.roleDefinition.update({ where: { id: teacher.id }, data: { name: 'Teacher' } })).resolves.toBeTruthy();
  });

  it('keeps the scope columns ready on UserRole: whole school by default, with a place for a department, class or hostel', async () => {
    const row = await prisma.userRole.findFirstOrThrow({ where: { userId: A.users.TEACHER.id } });
    expect(row).toMatchObject({ scopeType: 'SCHOOL', scopeId: '' });
    const hod = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'HOD' } });
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: A.users.TEACHER.id, roleId: hod.id, scopeType: 'DEPARTMENT', scopeId: 'sciences' } });
    expect((await prisma.userRole.findMany({ where: { userId: A.users.TEACHER.id } })).map((r) => r.scopeType).sort()).toEqual(['DEPARTMENT', 'SCHOOL']);
    await prisma.userRole.deleteMany({ where: { userId: A.users.TEACHER.id, roleId: hod.id } });
  });

  it('turns a role into an allowed one by data alone, in one school only', async () => {
    const get = (as: object) => call('system/users', 'GET', { as: as as never });
    expect((await get(A.users.BURSAR)).status).toBe(403);
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'system.users.view');
    expect((await get(A.users.BURSAR)).status).toBe(200);
    expect((await get(B.users.BURSAR)).status).toBe(403);
    await revokePermission(prisma, A.schoolId, 'BURSAR', 'system.users.view');
    expect((await get(A.users.BURSAR)).status).toBe(403);
  });

  it('adds up the grants of everyone\'s several roles', async () => {
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Two Roles', email: 'tworoles@a.test', role: 'TEACHER', passwordHash: 'x' } });
    const bursar = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'BURSAR' } });
    await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: u.id, roleId: bursar.id } });
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'system.users.view');
    const as = { id: u.id, email: u.email, schoolId: A.schoolId, role: 'TEACHER', fullName: u.fullName };
    expect((await call('system/users', 'GET', { as: as as never })).status).toBe(200);
    expect((await call('system/users', 'POST', { as: as as never, body: {} })).status).toBe(403);
    await revokePermission(prisma, A.schoolId, 'BURSAR', 'system.users.view');
  });
});

describe('the Roles & Permissions page', () => {
  it('is denied without system.roles.view and open to the administrator', async () => {
    const denied = (await render(A.users.TEACHER, '@/app/(dashboard)/system/roles/page', { searchParams: {} })) as unknown as { type: { name: string } };
    expect(denied.type.name).toBe('AccessDenied');
    const ok = await render(admin(), '@/app/(dashboard)/system/roles/page', { searchParams: {} });
    expect((ok as unknown as { type?: { name?: string } }).type?.name).not.toBe('AccessDenied');
  });

  it('lists the roles with a description and the number of users', async () => {
    const html = renderToStaticMarkup(await render(admin(), '@/app/(dashboard)/system/roles/page', { searchParams: {} }));
    for (const name of ['Owner', 'Head', 'Deputy Head', 'Administrator', 'Bursar', 'Accounts Clerk', 'HR Officer', 'Head of Department', 'Teacher', 'Class Teacher', 'Exams Officer', 'Librarian', 'Boarding Master']) {
      expect(html, name).toContain(name);
    }
    expect(html).toContain('Runs the library: books, borrowing and fines.');
    expect(html).toMatch(/Librarian<\/span><span[^>]*>1 user</);
    expect(html).toContain('By user');
  });

  it('opens a role to a read-only grid of ticks, with the note, and who holds it', async () => {
    const teacher = renderToStaticMarkup(await render(admin(), '@/app/(dashboard)/system/roles/[key]/page', { params: { key: 'TEACHER' } }));
    expect(teacher).toContain('Access levels will be configurable soon');
    expect(teacher.match(/✓/g)).toHaveLength(2); // the dashboard and the calendar, to look
    expect(teacher).toContain(A.users.TEACHER.fullName);
    expect(teacher).not.toContain('<input');
    const adminHtml = renderToStaticMarkup(await render(admin(), '@/app/(dashboard)/system/roles/[key]/page', { params: { key: 'ADMINISTRATOR' } }));
    expect(adminHtml.match(/✓/g)!.length).toBe(SYSTEM_PERMISSIONS.length);
    expect(adminHtml).toContain('full access');
    expect(adminHtml).toContain(A.users.ADMIN.fullName);
  });

  it('shows the placeholder for roles by user, and a 404 for a role that does not exist', async () => {
    const tab = renderToStaticMarkup(await render(admin(), '@/app/(dashboard)/system/roles/page', { searchParams: { tab: 'users' } }));
    expect(tab).toContain('coming soon');
    await expect(render(admin(), '@/app/(dashboard)/system/roles/[key]/page', { params: { key: 'NOPE' } })).rejects.toThrow();
    await expect(render(A.users.TEACHER, '@/app/(dashboard)/system/roles/[key]/page', { params: { key: 'OWNER' } })).resolves.toBeTruthy(); // denied page, not an error
  });
});

// ─── Audit log ───────────────────────────────────────────────────────────────

describe('the audit log', () => {
  const get = async (query = '', as: object = admin()) => (await call('system/audit-log', 'GET', { as: as as never, query })).json.data;

  it('keeps the address and browser of the caller on each entry, and the module of the record', async () => {
    req.headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'TestBrowser/1.0 (Windows)' });
    const r = await call('system/calendar', 'POST', { as: admin(), body: { title: 'Sports day', kind: 'OTHER', startDate: '2026-05-05', endDate: '2026-05-05' } });
    expect(r.status, r.text.slice(0, 200)).toBe(201);
    const rows = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'CalendarEvent', entityId: r.json.data.event?.id ?? r.json.data.id } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row).toMatchObject({ ip: '203.0.113.9', userAgent: 'TestBrowser/1.0 (Windows)', module: 'system' });
  });

  it('works out the module from the record, whoever writes the entry', async () => {
    const mk = (entityType: string) => prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'DATA_UPDATE', entityType, entityId: 'x' } });
    expect((await mk('Payment')).module).toBe('finance');
    expect((await mk('Student')).module).toBe('students');
    expect((await mk('Mark')).module).toBe('exams');
    expect((await mk('Asset')).module).toBe('facilities');
    expect((await mk('SubjectAssignment')).module).toBe('academics');
    expect((await mk('AcademicTerm')).module).toBe('system');
    expect((await mk('SomethingNew')).module).toBe('system');
  });

  it('lists date and time, user, action, module, record and address', async () => {
    const d = await get('?pageSize=10');
    const e = d.entries[0];
    for (const k of ['createdAt', 'actor', 'action', 'module', 'entityType', 'entityId', 'detail', 'ip']) expect(k in e, k).toBe(true);
    expect(e.actor.fullName).toBeTruthy();
  });

  it('filters by module and by action, and by date range', async () => {
    const fin = await get('?module=finance&pageSize=100');
    expect(fin.total).toBeGreaterThan(0);
    expect(fin.entries.every((x: { module: string }) => x.module === 'finance')).toBe(true);
    const sys = await get('?module=system&action=CREATE_CALENDAR_EVENT&pageSize=100');
    expect(sys.total).toBeGreaterThan(0);
    expect(sys.entries.every((x: { action: string; module: string }) => x.action === 'CREATE_CALENDAR_EVENT' && x.module === 'system')).toBe(true);
    expect((await get('?module=nonsense')).total).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`?from=${today}&to=${today}&module=finance`)).total).toBe(fin.total);
    expect((await get('?from=2020-01-01&to=2020-12-31')).total).toBe(0);
  });

  it('filters by user: entries they made and entries about them', async () => {
    const target = A.users.HEAD;
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: target.id, action: 'LOGIN_SUCCESS', entityType: 'User', entityId: target.id, detail: 'signed in' } });
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'UPDATE_USER', entityType: 'User', entityId: target.id, detail: 'Admin changed the head' } });
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'UPDATE_USER', entityType: 'User', entityId: A.users.BURSAR.id, detail: 'Admin changed the bursar' } });
    const both = await get(`?user=${target.id}&pageSize=100`);
    expect(both.entries.map((x: { detail: string }) => x.detail)).toEqual(expect.arrayContaining(['signed in', 'Admin changed the head']));
    expect(both.entries.some((x: { detail: string }) => x.detail === 'Admin changed the bursar')).toBe(false);
    const byOnly = await get(`?actor=${target.id}&pageSize=100`);
    expect(byOnly.entries.every((x: { actor: { id: string } }) => x.actor.id === target.id)).toBe(true);
    expect((await get(`?user=${B.users.HEAD.id}`)).total).toBe(0); // another school's person: nothing
  });

  it('searches by the name of the record', async () => {
    await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'CREATE_USER', entityType: 'User', entityId: 'new-1', detail: 'Tafadzwa Zhou (Teacher)' } });
    expect((await get('?q=tafadzwa')).total).toBe(1);
    expect((await get('?q=Zhou')).entries[0].detail).toBe('Tafadzwa Zhou (Teacher)');
    expect((await get('?q=new-1')).total).toBe(1);
    expect((await get('?q=nobody-by-this-name')).total).toBe(0);
  });

  it('exports exactly the filtered list as CSV, with the columns of the screen', async () => {
    const r = await call('system/audit-log', 'GET', { as: admin(), query: '?format=csv&module=finance' });
    expect(r.status).toBe(200);
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Date and time,User,Action,Action code,Module,Record type,Record,Record ID,IP');
    expect(lines.length - 1).toBe((await get('?module=finance')).total);
    expect(lines.slice(1).every((l) => l.includes('Finance'))).toBe(true);
    expect((await call('system/audit-log', 'GET', { as: A.users.TEACHER, query: '?format=csv' })).status).toBe(403);
    await grantPermission(prisma, A.schoolId, 'HEAD', 'system.audit.view');
    expect((await call('system/audit-log', 'GET', { as: A.users.HEAD })).status).toBe(200);
    expect((await call('system/audit-log', 'GET', { as: A.users.HEAD, query: '?format=csv' })).status).toBe(403); // view is not export
    await revokePermission(prisma, A.schoolId, 'HEAD', 'system.audit.view');
  });

  it('has no way to edit or delete an entry: not in the database, not in the app', async () => {
    await expect(prisma.auditLog.deleteMany({ where: { schoolId: A.schoolId } })).rejects.toThrow(/cannot be changed or deleted/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    await expect(prisma.auditLog.updateMany({ where: { schoolId: A.schoolId }, data: { detail: 'x' } })).rejects.toThrow(/cannot be changed or deleted/);
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      await expect(call('system/audit-log', method, { as: admin(), body: {} }), method).rejects.toThrow(/has no/);
    }
    // nothing in the code base changes or removes entries
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', 'tests', 'migrations', '.git'].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs)$/.test(e.name) && /auditLog\.(update|updateMany|delete|deleteMany|upsert)\b/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full));
      }
    };
    for (const d of ['app', 'lib', 'components', 'scripts']) walk(path.join(root, d));
    expect(offenders).toEqual([]);
  });

  it('is kept for at least 7 years', async () => {
    const { AUDIT_RETENTION_YEARS } = await import('@/lib/system/audit-log');
    expect(AUDIT_RETENTION_YEARS).toBeGreaterThanOrEqual(7);
    const old = await prisma.auditLog.create({ data: { schoolId: A.schoolId, actorId: admin().id, action: 'DATA_UPDATE', entityType: 'Student', entityId: 'old', createdAt: new Date('2019-01-01') } });
    expect(await prisma.auditLog.findUnique({ where: { id: old.id } })).not.toBeNull();
  });

  it('has an action for everything the spec says to log', async () => {
    const { AuditAction } = await import('@prisma/client');
    for (const a of [
      'CREATE_USER', 'UPDATE_USER', 'INVITE_USER', 'DEACTIVATE_USER', 'REACTIVATE_USER', 'RESET_PASSWORD', 'CREATE_PASSWORD_RESET', 'ROLES_CHANGED', 'LOGIN_SUCCESS', 'LOGIN_FAILED',
      'UPDATE_SCHOOL_SETTINGS', 'UPDATE_FINANCE_SETTINGS', 'UPDATE_NUMBERING', 'UPDATE_GRADING', 'UPDATE_FORMS', 'UPDATE_STREAMS',
      'CREATE_ACADEMIC_YEAR', 'OPEN_TERM', 'CLOSE_TERM', 'CREATE_CLASS', 'ARCHIVE_CLASS', 'CREATE_CALENDAR_EVENT', 'UPDATE_CALENDAR_EVENT', 'DELETE_CALENDAR_EVENT',
    ]) expect(Object.values(AuditAction), a).toContain(a);
  });

  it('logs people being added, changed, invited, deactivated, reactivated and given a reset link, and their sign-ins', async () => {
    const made = await call('system/users', 'POST', { as: admin(), body: { fullName: 'Audit Subject', email: 'auditsubject@a.test', phone: '0771234567', roles: ['TEACHER'] } });
    const id = made.json.data.user.id;
    await call('system/users/[id]', 'PATCH', { as: admin(), params: { id }, body: { phone: '0712345678' } });
    await call('system/users/[id]', 'PATCH', { as: admin(), params: { id }, body: { roles: ['TEACHER', 'HOD'] } });
    await call('system/users/[id]/invite', 'POST', { as: admin(), params: { id } });
    await call('system/users/[id]/reset-password', 'POST', { as: admin(), params: { id } });
    await call('system/users/[id]/deactivate', 'POST', { as: admin(), params: { id } });
    await call('system/users/[id]/reactivate', 'POST', { as: admin(), params: { id } });
    const actions = (await prisma.auditLog.findMany({ where: { entityType: 'User', entityId: id } })).map((x) => x.action);
    for (const a of ['CREATE_USER', 'INVITE_USER', 'UPDATE_USER', 'ROLES_CHANGED', 'CREATE_PASSWORD_RESET', 'DEACTIVATE_USER', 'REACTIVATE_USER']) expect(actions, a).toContain(a);
    // "view activity" for that person returns exactly these
    const activity = await get(`?user=${id}&pageSize=100`);
    expect(activity.total).toBe(actions.length);
  });

  it('shows the page to people who may see it, and denies the others', async () => {
    const denied = (await render(A.users.TEACHER, '@/app/(dashboard)/system/audit-log/page', { searchParams: {} })) as unknown as { type: { name: string } };
    expect(denied.type.name).toBe('AccessDenied');
    const ok = await render(admin(), '@/app/(dashboard)/system/audit-log/page', { searchParams: { module: 'finance', user: admin().id, q: 'x', from: '2026-01-01' } });
    expect((ok as unknown as { type?: { name?: string } }).type?.name).not.toBe('AccessDenied');
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe('notifications', () => {
  it('are sent with one helper, to several people at once, and never twice for the same key', async () => {
    const { notify } = await import('@/lib/system/notifications');
    const ids = [A.users.HEAD.id, A.users.BURSAR.id];
    expect(await notify(ids, { type: 'GENERAL', title: 'Hello all', body: 'Body', link: '/system/dashboard' })).toBe(2);
    const rows = await prisma.notification.findMany({ where: { title: 'Hello all' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ schoolId: A.schoolId, type: 'GENERAL', body: 'Body', link: '/system/dashboard', readAt: null });

    expect(await notify(ids, { title: 'Once', dedupeKey: 'k1' })).toBe(2);
    expect(await notify(ids, { title: 'Once', dedupeKey: 'k1' })).toBe(0);
    expect(await notify([A.users.HEAD.id], { title: 'Different key', dedupeKey: 'k2' })).toBe(1);
    expect(await notify([], { title: 'Nobody' })).toBe(0);
    expect(await notify(['no-such-user'], { title: 'Ghost' })).toBe(0);
  });

  it('reach each person in their own school, whichever schools the people are in', async () => {
    const { notify } = await import('@/lib/system/notifications');
    await notify([A.users.TEACHER.id, B.users.TEACHER.id], { title: 'Across schools' });
    const rows = await prisma.notification.findMany({ where: { title: 'Across schools' } });
    expect(Object.fromEntries(rows.map((r) => [r.userId, r.schoolId]))).toEqual({ [A.users.TEACHER.id]: A.schoolId, [B.users.TEACHER.id]: B.schoolId });
  });

  it('show the latest 10 in the bell with the unread count, newest first', async () => {
    const u = A.users.LIBRARIAN;
    for (let i = 1; i <= 15; i++) {
      await prisma.notification.create({ data: { schoolId: A.schoolId, userId: u.id, title: `Note ${i}`, createdAt: new Date(Date.now() - (16 - i) * 60_000) } });
    }
    const r = await call('system/notifications', 'GET', { as: u });
    expect(r.status).toBe(200);
    expect(r.json.data.items).toHaveLength(10);
    expect(r.json.data.items[0].title).toBe('Note 15');
    expect(r.json.data.items[9].title).toBe('Note 6');
    expect(r.json.data.unread).toBe(15);
    for (const k of ['id', 'title', 'body', 'link', 'type', 'readAt', 'createdAt']) expect(k in r.json.data.items[0], k).toBe(true);
    expect((await call('system/notifications', 'GET', { as: u, query: '?limit=3' })).json.data.items).toHaveLength(3);
    expect((await call('system/notifications', 'GET', { as: u, query: '?limit=9999' })).json.data.items.length).toBeLessThanOrEqual(50);
    // someone else's are not mine
    expect((await call('system/notifications', 'GET', { as: A.users.TEACHER })).json.data.items.every((x: { title: string }) => !x.title.startsWith('Note '))).toBe(true);
  });

  it('can be marked read one by one, or all at once, and only my own', async () => {
    const u = A.users.LIBRARIAN;
    const first = (await call('system/notifications', 'GET', { as: u })).json.data.items[0];
    expect((await call('system/notifications', 'POST', { as: u, body: { id: first.id } })).json.data.marked).toBe(1);
    expect((await call('system/notifications', 'GET', { as: u })).json.data.unread).toBe(14);
    expect((await call('system/notifications', 'POST', { as: A.users.TEACHER, body: { id: first.id } })).status).toBe(404);
    expect((await call('system/notifications', 'POST', { as: u, body: { all: true } })).json.data.marked).toBe(14);
    expect((await call('system/notifications', 'GET', { as: u })).json.data.unread).toBe(0);
    expect((await call('system/notifications', 'POST', { as: u, body: {} })).status).toBe(422);
  });

  it('have a full list page for each person, with the unread count', async () => {
    const ok = await render(A.users.LIBRARIAN, '@/app/(dashboard)/system/notifications/page', { searchParams: { page: '2' } });
    expect(ok).toBeTruthy();
    // The list holds this person's own notes (the page is built from them, so the tree carries their titles).
    const tree = JSON.stringify(await render(A.users.HEAD, '@/app/(dashboard)/system/notifications/page', { searchParams: {} }), ((seen) => (_k: string, v: unknown) => (v && typeof v === 'object' ? (seen.has(v) ? undefined : (seen.add(v), v)) : v))(new WeakSet()));
    expect(tree).toContain('Hello all');
    expect(tree).not.toContain('Note 15'); // the librarian's
  });

  it('welcome a person the first time they sign in, once, and log the sign-in with its address', async () => {
    const { hashPassword } = await import('@/lib/password');
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'New Starter', email: 'starter@a.test', role: 'TEACHER', passwordHash: await hashPassword('Starter-pass-123') } });
    const { authorizeCredentials } = await import('@/lib/auth');
    const request = new Request('https://pfuma.test/api/auth', { headers: { 'x-forwarded-for': '198.51.100.7', 'user-agent': 'Chrome/200' } });
    expect(await authorizeCredentials({ email: 'starter@a.test', password: 'Starter-pass-123' }, request)).toMatchObject({ id: u.id });
    expect(await authorizeCredentials({ email: 'starter@a.test', password: 'Starter-pass-123' }, request)).toMatchObject({ id: u.id });
    const welcome = await prisma.notification.findMany({ where: { userId: u.id, type: 'WELCOME' } });
    expect(welcome).toHaveLength(1);
    expect(welcome[0].title).toBe('Welcome to Pfuma');
    const logins = await prisma.auditLog.findMany({ where: { entityId: u.id, action: 'LOGIN_SUCCESS' } });
    expect(logins).toHaveLength(2);
    expect(logins[0]).toMatchObject({ ip: '198.51.100.7', userAgent: 'Chrome/200', module: 'system', actorId: u.id });
    expect(logins[0].detail).toBe('New Starter signed in');
    // a wrong password is logged as a failure, with the address
    await authorizeCredentials({ email: 'starter@a.test', password: 'wrong-wrong-wrong' }, request);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { entityId: u.id, action: 'LOGIN_FAILED' } });
    expect(failed.ip).toBe('198.51.100.7');
  });

  describe('on a schedule', () => {
    let runScheduledNotifications: typeof import('@/lib/system/scheduled').runScheduledNotifications;
    beforeAll(async () => {
      ({ runScheduledNotifications } = await import('@/lib/system/scheduled'));
      // Term 2 of 2027 opens on 5 January 2027 in school A.
      const year = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2027, startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
      await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: year.id, termNumber: 1, name: 'Term 1 2027', startDate: new Date('2027-01-05'), endDate: new Date('2027-04-09'), status: 'PLANNED' } });
    });

    it('tells everyone the day before a term opens, once', async () => {
      const evening = new Date('2027-01-04T10:00:00Z'); // 12:00 in Harare; tomorrow is 5 January
      const first = await runScheduledNotifications(evening);
      expect(first.termReminders).toBeGreaterThan(0);
      const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'TERM_OPENS_TOMORROW' } });
      expect(notes.every((n) => n.title === 'Term 1 2027 opens tomorrow')).toBe(true);
      const active = await prisma.user.count({ where: { schoolId: A.schoolId, active: true, isSupport: false } });
      expect(notes).toHaveLength(active);
      expect(new Set(notes.map((n) => n.userId)).size).toBe(active);
      expect(await prisma.notification.count({ where: { schoolId: B.schoolId, type: 'TERM_OPENS_TOMORROW' } })).toBe(0); // B has no such term
      expect((await runScheduledNotifications(evening)).termReminders).toBe(0); // run again: nothing new
      await runScheduledNotifications(new Date('2027-01-03T10:00:00Z')); // two days before: not yet
      expect(await prisma.notification.count({ where: { schoolId: A.schoolId, type: 'TERM_OPENS_TOMORROW' } })).toBe(active);
    });

    it('reminds the owners and administrators once a week while a setup step is incomplete', async () => {
      const monday = new Date('2027-02-01T05:00:00Z');
      const r1 = await runScheduledNotifications(monday);
      expect(r1.setupReminders).toBeGreaterThan(0);
      const notes = await prisma.notification.findMany({ where: { schoolId: A.schoolId, type: 'SETUP_INCOMPLETE' }, include: { user: true } });
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.user.role === 'ADMIN' || n.user.role === 'DIRECTOR')).toBe(true);
      expect(notes[0].title).toMatch(/setup steps? (is|are) still incomplete/);
      expect(notes[0].link).toMatch(/^\//);
      const people = await prisma.user.count({ where: { schoolId: A.schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } } } } } });
      const inWeek = (week: string) => prisma.notification.count({ where: { schoolId: A.schoolId, type: 'SETUP_INCOMPLETE', dedupeKey: `setup-weekly:${week}` } });
      expect(await inWeek('2027-02-01')).toBe(people);
      await runScheduledNotifications(new Date('2027-02-03T05:00:00Z')); // same week
      expect(await inWeek('2027-02-01')).toBe(people);
      expect(await inWeek('2027-02-08')).toBe(0);
      await runScheduledNotifications(new Date('2027-02-08T05:00:00Z')); // next week
      expect(await inWeek('2027-02-08')).toBe(people);
    });

    it('leaves suspended schools alone', async () => {
      const sent = (schoolId: string) => prisma.notification.count({ where: { schoolId, type: 'SETUP_INCOMPLETE', dedupeKey: 'setup-weekly:2027-03-01' } });
      await prisma.school.update({ where: { id: B.schoolId }, data: { status: 'SUSPENDED' } });
      await runScheduledNotifications(new Date('2027-03-01T05:00:00Z'));
      expect(await sent(B.schoolId)).toBe(0);
      expect(await sent(A.schoolId)).toBeGreaterThan(0); // the other school still gets its reminder
      await prisma.school.update({ where: { id: B.schoolId }, data: { status: 'ACTIVE' } });
    });

    it('is started by the scheduler only, with the secret', async () => {
      const route = (await import('@/app/api/cron/notifications/route')).GET as (r: Request) => Promise<Response>;
      const ask = (auth?: string) => route(new Request('https://pfuma.test/api/cron/notifications', { headers: auth ? { authorization: auth } : {} }));
      delete process.env.CRON_SECRET;
      expect((await ask('Bearer anything')).status).toBe(401); // no secret configured: closed to everyone
      process.env.CRON_SECRET = 'cron-secret-value';
      expect((await ask()).status).toBe(401);
      expect((await ask('Bearer wrong')).status).toBe(401);
      expect((await ask('cron-secret-value')).status).toBe(401);
      const ok = await ask('Bearer cron-secret-value');
      expect(ok.status).toBe(200);
      expect((await ok.json()).data).toMatchObject({ schools: expect.any(Number) });
      delete process.env.CRON_SECRET;
    });
  });
});

// ─── My profile ──────────────────────────────────────────────────────────────

describe('my profile', () => {
  const patch = (as: object, body: object) => call('system/profile', 'PATCH', { as: as as never, body });

  it('lets anyone change their own name and phone, and logs it with before and after', async () => {
    const me = A.users.TEACHER;
    const r = await patch(me, { fullName: 'teacher MOYO-chari', phone: '0782223344' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).toMatchObject({ fullName: 'Teacher Moyo-Chari', phone: '+263782223344' });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: me.id, action: 'UPDATE_USER', actorId: me.id }, orderBy: { createdAt: 'desc' } });
    expect(entry.detail).toBe('Changed own name, phone');
    expect(entry.before).toMatchObject({ fullName: me.fullName });
    expect(entry.after).toMatchObject({ fullName: 'Teacher Moyo-Chari', phone: '+263782223344' });
    const n = await prisma.auditLog.count({ where: { entityId: me.id, action: 'UPDATE_USER' } });
    await patch(me, { fullName: 'Teacher Moyo-Chari' }); // nothing changed: nothing logged
    expect(await prisma.auditLog.count({ where: { entityId: me.id, action: 'UPDATE_USER' } })).toBe(n);
  });

  it('takes a photo that was uploaded here, and can remove it', async () => {
    const me = A.users.LIBRARIAN;
    expect((await patch(me, { photoUrl: 'https://utfs.io/f/abc123.png' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).photoUrl).toBe('https://utfs.io/f/abc123.png');
    expect((await patch(me, { photoUrl: '' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).photoUrl).toBeNull();
    for (const photoUrl of ['https://evil.example/x.png', 'http://utfs.io/f/a.png', 'javascript:alert(1)']) expect((await patch(me, { photoUrl })).status, photoUrl).toBe(422);
    await expect(prisma.user.update({ where: { id: me.id }, data: { photoUrl: 'http://insecure.example/a.png' } })).rejects.toThrow();
    await prisma.$queryRaw`SELECT 1`.catch(() => null);
  });

  it('cannot change anyone else, the email, or the roles', async () => {
    const me = A.users.BURSAR;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, include: { userRoles: true } });
    const other = await prisma.user.findUniqueOrThrow({ where: { id: B.users.BURSAR.id } });
    const r = await patch(me, { fullName: 'Bursar Person', email: 'taken@over.test', role: 'ADMIN', roles: ['OWNER'], id: B.users.BURSAR.id, userId: B.users.BURSAR.id, schoolId: B.schoolId });
    expect(r.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: me.id }, include: { userRoles: true } });
    expect(after).toMatchObject({ email: before.email, role: before.role, schoolId: A.schoolId });
    expect(after.userRoles.map((x) => x.roleId).sort()).toEqual(before.userRoles.map((x) => x.roleId).sort());
    expect(await prisma.user.findUniqueOrThrow({ where: { id: B.users.BURSAR.id } })).toMatchObject({ fullName: other.fullName, email: other.email });
  });

  it('refuses nothing-to-change, a bad phone and a bad name, and needs a sign-in', async () => {
    for (const body of [{}, { phone: '123' }, { fullName: 'x' }]) expect((await patch(A.users.TEACHER, body)).status, JSON.stringify(body)).toBe(422);
    expect((await call('system/profile', 'PATCH', { as: null, body: { fullName: 'Nobody' } })).status).toBe(401);
  });

  it('shows my details and my roles with their descriptions', async () => {
    const tree = (await render(A.users.TEACHER, '@/app/(dashboard)/system/profile/page')) as unknown as { props: { children: { props: Record<string, unknown> }[] } };
    const form = tree.props.children[1].props as { phone: string; roles: { key: string; name: string; description: string }[]; canUpdate: boolean; canChangePassword: boolean };
    expect(form.phone).toBe('+263782223344');
    expect(form.roles).toEqual([{ key: 'TEACHER', name: 'Teacher', description: expect.stringContaining('Teaches classes') }]);
    expect(form.canUpdate && form.canChangePassword).toBe(true);
  });
});
