import { describe, expect, it } from 'vitest';
import {
  can, disabledModulesFrom, FULL_ACCESS_ROLES, MODULES, moduleOf, PERMISSIONS, type AccessUser,
} from '@/lib/access-core';
import { buildNav, NAV_GROUPS } from '@/lib/nav';
import { toCsv } from '@/lib/csv';
import { parseTableQuery } from '@/lib/table-query';
import { termLabel } from '@/lib/term-label';
import { subscriptionView } from '@/lib/system/subscription';
import { pickViewTerm } from '@/lib/system/view-term';
import { termProgress } from '@/lib/system/dashboard';
import { CalendarEventSchema, ModulesSchema } from '@/lib/validations/system';
import { z } from 'zod';

const user = (role: AccessUser['role'], extra: Partial<AccessUser> = {}): AccessUser => ({ id: 'u1', schoolId: 's1', role, ...extra });
const SYSTEM_KEYS = Object.keys(PERMISSIONS).filter((k) => moduleOf(k) === 'system');

describe('can()', () => {
  it('lets administrators and owners do everything', () => {
    for (const role of FULL_ACCESS_ROLES) for (const k of Object.keys(PERMISSIONS)) expect(can(user(role), k), `${role} ${k}`).toBe(true);
    expect(FULL_ACCESS_ROLES).toEqual(['ADMIN', 'DIRECTOR']);
  });

  it('refuses everyone else on every System permission', () => {
    for (const role of ['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const) {
      for (const k of SYSTEM_KEYS) expect(can(user(role), k), `${role} ${k}`).toBe(false);
    }
  });

  it('refuses a signed-out caller and a permission key that does not exist', () => {
    expect(can(null, 'system.users.view')).toBe(false);
    expect(can(undefined, 'system.users.view')).toBe(false);
    expect(can(user('ADMIN'), 'system.users.vieww')).toBe(false);
    expect(can(user('ADMIN'), '')).toBe(false);
  });

  it('refuses a module that is switched off, even for the administrator', () => {
    const admin = user('ADMIN', { disabledModules: ['finance'] });
    expect(can(admin, 'finance.payments.view')).toBe(false);
    expect(can(admin, 'students.list.view')).toBe(true);
    expect(can(admin, 'system.users.view')).toBe(true);
  });

  it('never switches the System module off', () => {
    const admin = user('ADMIN', { disabledModules: ['system'] });
    expect(can(admin, 'system.subscription.manage')).toBe(true);
    expect(disabledModulesFrom([{ module: 'system', enabled: false }, { module: 'hr', enabled: false }, { module: 'finance', enabled: true }])).toEqual(['hr']);
  });

  it('gives every signed-in user their own profile, password and notifications', () => {
    for (const role of ['ADMIN', 'TEACHER', 'LIBRARIAN'] as const) {
      for (const k of ['account.profile.view', 'account.password.change', 'account.notifications.view', 'account.term.view']) expect(can(user(role), k)).toBe(true);
    }
    expect(can(null, 'account.profile.view')).toBe(false);
  });

  it('takes a scope into account: another school is never allowed', () => {
    expect(can(user('ADMIN'), 'system.users.view', { schoolId: 's1' })).toBe(true);
    expect(can(user('ADMIN'), 'system.users.view', { schoolId: 's2' })).toBe(false);
  });

  it('is data-driven for other roles: a granted key works, an ungranted one does not, a switched-off module still wins', () => {
    const head = user('HEAD', { grants: ['system.users.view', 'finance.payments.view'] });
    expect(can(head, 'system.users.view')).toBe(true);
    expect(can(head, 'system.users.create')).toBe(false);
    expect(can({ ...head, disabledModules: ['finance'] }, 'finance.payments.view')).toBe(false);
  });

  it('keeps every key in the catalogue inside a known module (or the self-service account module)', () => {
    const known = new Set<string>([...MODULES.map((m) => m.key), 'account']);
    for (const k of Object.keys(PERMISSIONS)) expect(known.has(moduleOf(k)), k).toBe(true);
  });
});

describe('sidebar', () => {
  it('lists the groups in the required order', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Dashboard & System', 'Student Information', 'Academics', 'Examinations', 'Finance', 'HR & Staff', 'Facilities & Operations', 'Communication',
    ]);
    expect(NAV_GROUPS[0].items.map((i) => i.label)).toEqual(['Dashboard', 'Calendar', 'School Settings', 'Users', 'Roles & Permissions', 'Audit Log', 'Subscription']);
  });

  it('makes only Dashboard & System live; every other item is "coming soon"', () => {
    const nav = buildNav(user('ADMIN'));
    expect(nav.map((g) => g.module)).toEqual(MODULES.map((m) => m.key));
    for (const g of nav) for (const i of g.items) expect(i.comingSoon, `${g.label} / ${i.label}`).toBe(g.module !== 'system');
    for (const i of nav[0].items) expect(i.href).toMatch(/^\/system\//);
  });

  it('hides a whole group when its module is switched off', () => {
    const nav = buildNav(user('ADMIN', { disabledModules: ['finance', 'hr'] }));
    expect(nav.map((g) => g.module)).not.toContain('finance');
    expect(nav.map((g) => g.module)).not.toContain('hr');
    expect(nav.length).toBe(6);
  });

  it('hides items the user may not use, and shows nothing to someone with no permissions', () => {
    expect(buildNav(user('TEACHER'))).toEqual([]);
    const some = buildNav(user('HEAD', { grants: ['system.users.view', 'system.audit.view'] }));
    expect(some).toHaveLength(1);
    expect(some[0].items.map((i) => i.label)).toEqual(['Users', 'Audit Log']);
  });
});

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['line\nbreak', 1]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",1\r\n');
  });
  it('defuses spreadsheet formulas', () => {
    const out = toCsv(['v'], [['=HYPERLINK("http://evil")'], ['+1'], ['-1'], ['@SUM(A1)'], ['safe']]);
    expect(out).toContain("'=HYPERLINK");
    expect(out).toContain("'+1");
    expect(out).toContain("'-1");
    expect(out).toContain("'@SUM");
    expect(out).toContain('\r\nsafe\r\n');
  });
});

describe('table query', () => {
  const opts = { sortable: ['name', 'role'], filterKeys: { role: z.enum(['ADMIN', 'TEACHER']) }, defaultSort: 'name' };
  it('uses defaults for nothing', () => {
    expect(parseTableQuery(new URLSearchParams(), opts)).toMatchObject({ q: '', sort: 'name', dir: 'asc', page: 1, pageSize: 25, filters: {} });
  });
  it('ignores a sort column, filter value, page or page size it does not accept', () => {
    const q = parseTableQuery(new URLSearchParams('sort=passwordHash&dir=sideways&page=-4&pageSize=100000&role=ROOT'), opts);
    expect(q).toMatchObject({ sort: 'name', dir: 'asc', page: 1, pageSize: 25, filters: {} });
  });
  it('reads valid values', () => {
    const q = parseTableQuery(new URLSearchParams('q=%20tendai%20&sort=role&dir=desc&page=3&pageSize=50&role=TEACHER'), opts);
    expect(q).toMatchObject({ q: 'tendai', sort: 'role', dir: 'desc', page: 3, pageSize: 50, filters: { role: 'TEACHER' } });
  });
  it('reads Next.js searchParams objects', () => {
    expect(parseTableQuery({ page: ['2', '3'], q: 'x' }, opts)).toMatchObject({ page: 2, q: 'x' });
  });
});

describe('term helpers', () => {
  it('shows terms as "2026 Term 3"', () => {
    expect(termLabel('Term 3 2026')).toBe('2026 Term 3');
    expect(termLabel('Holiday school')).toBe('Holiday school');
  });
  it('picks the chosen term, else the open one, else the first', () => {
    const terms = [{ id: 'a', status: 'CLOSED' }, { id: 'b', status: 'OPEN' }, { id: 'c', status: 'PLANNED' }];
    expect(pickViewTerm(terms, 'c')?.id).toBe('c');
    expect(pickViewTerm(terms, 'zzz')?.id).toBe('b');
    expect(pickViewTerm(terms, undefined)?.id).toBe('b');
    expect(pickViewTerm([{ id: 'a', status: 'CLOSED' }], undefined)?.id).toBe('a');
    expect(pickViewTerm([], 'a')).toBeNull();
  });
  it('measures how far through a term today is', () => {
    const term = { startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-01-10T00:00:00Z') };
    expect(termProgress(term, new Date('2025-12-31T00:00:00Z')).state).toBe('upcoming');
    expect(termProgress(term, new Date('2026-01-06T00:00:00Z'))).toMatchObject({ state: 'running', percent: 50 });
    expect(termProgress(term, new Date('2026-01-11T00:00:00Z'))).toMatchObject({ state: 'ended', percent: 100 });
  });
});

describe('subscription', () => {
  const base = { plan: 'STANDARD', status: 'ACTIVE' as const, startsAt: new Date('2026-01-01'), studentLimit: null };
  const now = new Date('2026-06-01');
  it('has no end date and never expires', () => {
    expect(subscriptionView({ ...base, endsAt: null }, now)).toMatchObject({ status: 'ACTIVE', daysLeft: null, expiringSoon: false });
  });
  it('warns in the last 30 days', () => {
    expect(subscriptionView({ ...base, endsAt: new Date('2026-06-20') }, now)).toMatchObject({ status: 'ACTIVE', expiringSoon: true, daysLeft: 19 });
    expect(subscriptionView({ ...base, endsAt: new Date('2026-12-20') }, now).expiringSoon).toBe(false);
  });
  it('reads a lapsed plan as expired, but leaves a cancelled one cancelled', () => {
    expect(subscriptionView({ ...base, endsAt: new Date('2026-05-01') }, now).status).toBe('EXPIRED');
    expect(subscriptionView({ ...base, status: 'CANCELLED', endsAt: new Date('2026-05-01') }, now).status).toBe('CANCELLED');
  });
});

describe('input rules (Zod)', () => {
  it('checks calendar events', () => {
    const ok = { title: 'Heroes Day', kind: 'PUBLIC_HOLIDAY', startDate: '2026-08-10', endDate: '2026-08-11' };
    expect(CalendarEventSchema.safeParse(ok).success).toBe(true);
    expect(CalendarEventSchema.safeParse({ ...ok, endDate: '2026-08-09' }).success).toBe(false);
    expect(CalendarEventSchema.safeParse({ ...ok, startDate: '2026-02-30', endDate: '2026-03-01' }).success).toBe(false);
    expect(CalendarEventSchema.safeParse({ ...ok, startDate: '10/08/2026' }).success).toBe(false);
    expect(CalendarEventSchema.safeParse({ ...ok, kind: 'PARTY' }).success).toBe(false);
    expect(CalendarEventSchema.safeParse({ ...ok, title: '' }).success).toBe(false);
  });

  it('checks module switches: known modules only, System cannot be off', () => {
    expect(ModulesSchema.safeParse({ modules: { finance: false, hr: true } }).success).toBe(true);
    expect(ModulesSchema.safeParse({ modules: { system: false } }).success).toBe(false);
    expect(ModulesSchema.safeParse({ modules: { payroll: false } }).success).toBe(false);
    expect(ModulesSchema.safeParse({ modules: { finance: 'no' } }).success).toBe(false);
  });
});
