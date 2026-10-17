import { beforeAll, describe, expect, it } from 'vitest';
import { actionLabel, diffValues, entityLabel, moduleLabel, recordHref } from '@/lib/system/audit-labels';
import { PRESETS, PRESET_KEYS, presetModules } from '@/lib/platform/presets';
import { cookieFrom, platformCookie, readPlatformToken, signPlatformToken, PLATFORM_COOKIE, PLATFORM_SESSION_SECONDS } from '@/lib/platform/session';
import { supportBlocked } from '@/lib/support-guard';
import { weekStart } from '@/lib/system/scheduled';
import { subscriptionView } from '@/lib/system/subscription';
import { MODULE_KEYS } from '@/lib/access-core';
import { BillingPatchSchema, CreateInvoiceSchema, CreateSchoolSchema, ModulesPatchSchema, SupportStartSchema, SuspendSchema } from '@/lib/validations/platform';
import { ProfileSchema } from '@/lib/validations/system';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-platform-tokens';
});

describe('the console sign-in cookie', () => {
  const now = Date.UTC(2026, 9, 16, 10, 0, 0);

  it('carries the admin and token version and can be read back', () => {
    const value = signPlatformToken('admin-1', 3, now);
    expect(readPlatformToken(value, now)).toEqual({ adminId: 'admin-1', tokenVersion: 3 });
  });

  it('expires after 8 hours', () => {
    const value = signPlatformToken('admin-1', 0, now);
    expect(readPlatformToken(value, now + (PLATFORM_SESSION_SECONDS - 1) * 1000)).not.toBeNull();
    expect(readPlatformToken(value, now + (PLATFORM_SESSION_SECONDS + 1) * 1000)).toBeNull();
  });

  it('refuses anything that was changed, made with another secret, or is not in the format', () => {
    const [id, version, exp, sig] = signPlatformToken('admin-1', 1, now).split('.');
    expect(readPlatformToken(`admin-2.${version}.${exp}.${sig}`, now)).toBeNull();
    expect(readPlatformToken(`${id}.9.${exp}.${sig}`, now)).toBeNull();
    expect(readPlatformToken(`${id}.${version}.${Number(exp) + 99999}.${sig}`, now)).toBeNull();
    expect(readPlatformToken(`${id}.${version}.${exp}.${sig.slice(0, -2)}xx`, now)).toBeNull();
    for (const junk of ['', 'abc', 'a.b.c', 'a.b.c.d.e', null, undefined]) expect(readPlatformToken(junk as never, now), String(junk)).toBeNull();
    process.env.NEXTAUTH_SECRET = 'another-secret';
    expect(readPlatformToken(signPlatformToken('admin-1', 1, now), now)).not.toBeNull();
    const before = signPlatformToken('admin-1', 1, now);
    process.env.NEXTAUTH_SECRET = 'test-secret-for-platform-tokens';
    expect(readPlatformToken(before, now)).toBeNull();
  });

  it('is an httpOnly, strict cookie that can be cleared', () => {
    expect(platformCookie('abc')).toMatch(/^pfuma_platform=abc; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800/);
    expect(platformCookie('', 0)).toContain('Max-Age=0');
    expect(cookieFrom(`a=1; ${PLATFORM_COOKIE}=xyz.1.2.3; b=2`, PLATFORM_COOKIE)).toBe('xyz.1.2.3');
    expect(cookieFrom(null, PLATFORM_COOKIE)).toBeUndefined();
  });
});

describe('support sessions', () => {
  it('may read everything and change nothing, except leaving and signing out', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(supportBlocked(m, '/api/system/users'), m).toBe(false);
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(supportBlocked(m, '/api/system/users'), m).toBe(true);
      expect(supportBlocked(m, '/api/upload'), m).toBe(true);
      expect(supportBlocked(m, '/api/accounting/payments'), m).toBe(true);
    }
    expect(supportBlocked('POST', '/api/system/support/end')).toBe(false);
    expect(supportBlocked('POST', '/api/auth/signout')).toBe(false);
    expect(supportBlocked('POST', '/system/dashboard')).toBe(false); // pages are not API calls
    expect(supportBlocked('post', '/api/system/users')).toBe(true);
  });
});

describe('presets', () => {
  it('has three, each giving every module a state and always keeping System on', () => {
    expect(PRESET_KEYS).toEqual(['GOVERNMENT_DAY', 'GOVERNMENT_BOARDING', 'PRIVATE']);
    for (const k of PRESET_KEYS) {
      const m = presetModules(k);
      expect(Object.keys(m).sort()).toEqual([...MODULE_KEYS].sort());
      expect(m.system, k).toBe(true);
    }
    expect(presetModules('GOVERNMENT_DAY').facilities).toBe(false);
    expect(presetModules('GOVERNMENT_BOARDING').facilities).toBe(true);
    expect(PRESETS.PRIVATE.schoolType).toBe('PRIVATE');
    expect(PRESETS.GOVERNMENT_BOARDING.boarding).toBe('BOARDING');
  });
});

describe('console input rules', () => {
  const person = (n: string) => ({ fullName: `${n} person`, email: `${n}@school.test`, phone: '0771234567' });
  const school = { name: 'Chipembere High', schoolType: 'GOVERNMENT', province: 'Harare', preset: 'GOVERNMENT_DAY', owner: person('owner'), administrator: person('admin') };

  it('accepts a school with an owner and an administrator, and tidies it', () => {
    const r = CreateSchoolSchema.safeParse({ ...school, owner: { ...school.owner, fullName: 'tendai MOYO', phone: '+263 77 123 4567' } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.owner).toMatchObject({ fullName: 'Tendai Moyo', phone: '+263771234567' });
      expect(r.data.status).toBe('TRIAL');
    }
  });

  it('refuses the same email for both, bad provinces, presets, and missing parts', () => {
    const bad: object[] = [
      { administrator: person('owner') },
      { province: 'Atlantis' }, { preset: 'FREE' }, { schoolType: 'ACADEMY' }, { name: 'x' }, { name: '' },
      { owner: { ...person('o'), phone: '12345' } }, { administrator: { ...person('a'), email: 'nope' } }, { owner: undefined },
      { renewalDate: '2026-02-30' }, { studentLimit: 0 }, { status: 'SUSPENDED' },
    ];
    for (const b of bad) expect(CreateSchoolSchema.safeParse({ ...school, ...b }).success, JSON.stringify(b)).toBe(false);
  });

  it('checks modules, billing, suspension, invoices and the support reason', () => {
    expect(ModulesPatchSchema.safeParse({ modules: { finance: false } }).success).toBe(true);
    expect(ModulesPatchSchema.safeParse({ preset: 'PRIVATE' }).success).toBe(true);
    expect(ModulesPatchSchema.safeParse({}).success).toBe(false);
    expect(ModulesPatchSchema.safeParse({ modules: { system: false } }).success).toBe(false);
    expect(ModulesPatchSchema.safeParse({ modules: { payroll: true } }).success).toBe(false);

    expect(BillingPatchSchema.safeParse({ studentLimit: 800, renewalDate: '2027-01-01', status: 'ACTIVE' }).success).toBe(true);
    expect(BillingPatchSchema.safeParse({ studentLimit: '' }).success).toBe(true);
    expect(BillingPatchSchema.safeParse({}).success).toBe(false);
    expect(BillingPatchSchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false); // suspension has its own route

    expect(SuspendSchema.safeParse({ reason: 'Not paid since March' }).success).toBe(true);
    expect(SuspendSchema.safeParse({ reason: 'no' }).success).toBe(false);

    expect(CreateInvoiceSchema.safeParse({ amount: '120.50', description: 'Standard plan, Term 1' }).success).toBe(true);
    for (const b of [{ amount: 0 }, { amount: -5 }, { amount: 'a lot' }, { description: '' }, { currency: 'EUR' }, { dueOn: '2026-13-01' }]) {
      expect(CreateInvoiceSchema.safeParse({ amount: 10, description: 'Fee', ...b }).success, JSON.stringify(b)).toBe(false);
    }

    expect(SupportStartSchema.safeParse({ reason: 'Bursar reported a wrong balance' }).success).toBe(true);
    expect(SupportStartSchema.safeParse({ reason: 'just looking' }).success).toBe(true);
    expect(SupportStartSchema.safeParse({ reason: 'short' }).success).toBe(false);
  });
});

describe('my profile input rules', () => {
  it('takes a name, a Zimbabwe mobile and an uploaded photo, tidied', () => {
    const r = ProfileSchema.safeParse({ fullName: 'tendai MOYO', phone: '0771 234 567', photoUrl: 'https://utfs.io/f/abc.png' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ fullName: 'Tendai Moyo', phone: '+263771234567', photoUrl: 'https://utfs.io/f/abc.png' });
    const cleared = ProfileSchema.safeParse({ photoUrl: '' });
    expect(cleared.success && cleared.data.photoUrl).toBeNull();
  });
  it('refuses nothing to change, a bad phone, and a photo that was not uploaded here', () => {
    for (const b of [{}, { phone: '12345' }, { fullName: 'x' }, { photoUrl: 'https://evil.example/x.png' }, { photoUrl: 'javascript:alert(1)' }, { photoUrl: 'http://utfs.io/f/a.png' }]) {
      expect(ProfileSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    }
  });
});

describe('audit log wording', () => {
  it('reads the actions the way the spec names them', () => {
    expect(actionLabel('CREATE_USER')).toBe('User created');
    expect(actionLabel('ROLES_CHANGED')).toBe('Roles changed');
    expect(actionLabel('LOGIN_SUCCESS')).toBe('Login succeeded');
    expect(actionLabel('LOGIN_FAILED')).toBe('Login failed');
    expect(actionLabel('OPEN_TERM')).toBe('Term opened');
    expect(actionLabel('ARCHIVE_CLASS')).toBe('Class archived');
    expect(actionLabel('DELETE_CALENDAR_EVENT')).toBe('Calendar event deleted');
    expect(actionLabel('RECORD_PAYMENT')).toBe('Record payment'); // not listed: reads as a sentence
    expect(moduleLabel('system')).toBe('Dashboard & System');
    expect(moduleLabel(null)).toBe('—');
    expect(entityLabel('SchoolClass')).toBe('Class');
    expect(entityLabel('Payment')).toBe('Payment');
  });

  it('links the records that have a page', () => {
    expect(recordHref('User', 'u 1')).toBe('/system/users?q=u%201');
    expect(recordHref('CalendarEvent', 'e1')).toBe('/system/calendar');
    expect(recordHref('AcademicTerm', 't1')).toBe('/system/settings?tab=years');
    expect(recordHref('SchoolClass', 'c1')).toBe('/system/settings?tab=structure');
    expect(recordHref('Payment', 'p1')).toBeNull();
  });

  it('lines up before and after, and marks what changed', () => {
    const rows = diffValues({ fullName: 'A', phone: '+263771', title: null }, { fullName: 'B', phone: '+263771', title: 'Mr', extra: true });
    expect(rows).toEqual([
      { field: 'fullName', before: 'A', after: 'B', changed: true },
      { field: 'phone', before: '+263771', after: '+263771', changed: false },
      { field: 'title', before: 'empty', after: 'Mr', changed: true },
      { field: 'extra', before: '—', after: 'true', changed: true },
    ]);
    expect(diffValues(undefined, { a: 1 })).toEqual([{ field: 'a', before: '—', after: '1', changed: true }]);
    expect(diffValues({ a: [1, 2] }, undefined)).toEqual([{ field: 'a', before: '[1,2]', after: '—', changed: true }]);
    expect(diffValues(undefined, undefined)).toEqual([]);
    expect(diffValues({ nested: { x: 1 } }, { nested: { x: 2 } })[0]).toMatchObject({ changed: true });
  });
});

describe('the weekly reminder key', () => {
  it('is the Monday of the week', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-16')).toBe('2026-10-12'); // Friday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });
});

describe('subscription banner wording', () => {
  it('names the days, and what suspended means', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    const mk = (status: 'ACTIVE' | 'SUSPENDED', d: string | null) => subscriptionView({ status, renewalDate: d ? new Date(`${d}T00:00:00Z`) : null, studentLimit: null }, now).banner;
    expect(mk('ACTIVE', '2026-06-11')?.text).toBe('Your subscription renews in 10 days.');
    expect(mk('SUSPENDED', null)?.text).toMatch(/look at records|look at/i);
  });
});
