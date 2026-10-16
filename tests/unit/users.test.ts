import { describe, expect, it } from 'vitest';
import { capitalizeName } from '@/lib/names';
import { accessFor, parseStaffRole, STAFF_ROLES, STAFF_ROLE_KEYS } from '@/lib/staff-roles';
import { statusOf, userWhere } from '@/lib/system/users';
import { parseTableQuery } from '@/lib/table-query';
import { SystemCreateUserSchema, SystemUpdateUserSchema } from '@/lib/validations/system';
import { INVITE_TTL_MS, RESET_TTL_MS, resetUrl } from '@/lib/password-reset';

describe('names', () => {
  it('capitalises what was typed in one case, part by part', () => {
    expect(capitalizeName('tendai moyo')).toBe('Tendai Moyo');
    expect(capitalizeName('TENDAI MOYO')).toBe('Tendai Moyo');
    expect(capitalizeName('  tendai   MOYO ')).toBe('Tendai Moyo');
    expect(capitalizeName('rudo MOYO-chari')).toBe('Rudo Moyo-Chari');
    expect(capitalizeName("o'brien")).toBe("O'Brien");
    expect(capitalizeName('nyasha\tchari')).toBe('Nyasha Chari');
    expect(capitalizeName('élise dube')).toBe('Élise Dube');
  });
  it('leaves a part that already mixes cases as written', () => {
    expect(capitalizeName('Ian McDonald')).toBe('Ian McDonald');
    expect(capitalizeName('tendai McDonald')).toBe('Tendai McDonald');
    expect(capitalizeName('Tendai Moyo')).toBe('Tendai Moyo');
  });
});

describe('roles', () => {
  it('are 13, each with a name and an access level', () => {
    expect(STAFF_ROLES).toHaveLength(13);
    expect(new Set(STAFF_ROLE_KEYS).size).toBe(13);
    for (const r of STAFF_ROLES) expect(['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'LIBRARIAN', 'TEACHER']).toContain(r.access);
  });
  it('give a person the highest access of any role they hold', () => {
    expect(accessFor(['TEACHER'])).toBe('TEACHER');
    expect(accessFor(['TEACHER', 'CLASS_TEACHER'])).toBe('TEACHER');
    expect(accessFor(['TEACHER', 'BURSAR'])).toBe('BURSAR');
    expect(accessFor(['LIBRARIAN', 'TEACHER'])).toBe('LIBRARIAN');
    expect(accessFor(['DEPUTY_HEAD', 'BURSAR', 'LIBRARIAN'])).toBe('HEAD');
    expect(accessFor(['OWNER', 'HEAD_TEACHER'])).toBe('DIRECTOR');
    expect(accessFor(['TEACHER', 'SCHOOL_ADMINISTRATOR', 'OWNER'])).toBe('ADMIN');
    expect(accessFor([])).toBe('TEACHER');
  });
  it('are read from the names people write in a spreadsheet', () => {
    expect(parseStaffRole('Head Teacher')).toBe('HEAD_TEACHER');
    expect(parseStaffRole(' head_teacher ')).toBe('HEAD_TEACHER');
    expect(parseStaffRole('HEAD-OF-DEPARTMENT')).toBe('HEAD_OF_DEPARTMENT');
    expect(parseStaffRole('school administrator')).toBe('SCHOOL_ADMINISTRATOR');
    expect(parseStaffRole('Teacher')).toBe('TEACHER');
    expect(parseStaffRole('HOD')).toBeNull();
    expect(parseStaffRole('')).toBeNull();
    expect(parseStaffRole('Principal')).toBeNull();
  });
});

describe('the add-user form rules', () => {
  const ok = { fullName: 'tendai MOYO', email: ' Tendai@School.CO.zw ', phone: '0771 234 567', roles: ['TEACHER', 'BURSAR', 'TEACHER'] };
  const parse = (over: object = {}) => SystemCreateUserSchema.safeParse({ ...ok, ...over });

  it('tidies a good entry and defaults to an invite', () => {
    const r = parse();
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ fullName: 'Tendai Moyo', email: 'tendai@school.co.zw', phone: '+263771234567', roles: ['TEACHER', 'BURSAR'], signIn: 'INVITE' });
  });
  it('names are 2 to 80 characters', () => {
    expect(parse({ fullName: 'Ab' }).success).toBe(true);
    expect(parse({ fullName: 'A' }).success).toBe(false);
    expect(parse({ fullName: ' '.repeat(5) }).success).toBe(false);
    expect(parse({ fullName: 'x'.repeat(80) }).success).toBe(true);
    expect(parse({ fullName: 'x'.repeat(81) }).success).toBe(false);
  });
  it('phone must be a Zimbabwe mobile and is stored as +263 and nine digits', () => {
    for (const p of ['0771234567', '+263771234567', '263 77 123 4567', '077-123-4567', '0712345678', '0731234567', '0781234567']) expect(parse({ phone: p }).data?.phone, p).toMatch(/^\+263\d{9}$/);
    for (const p of ['', '0242700123', '+27821234567', '07712345', '0791234567', 'abc', '07712345678']) expect(parse({ phone: p }).success, p).toBe(false);
  });
  it('needs at least one role and only known ones', () => {
    expect(parse({ roles: [] }).success).toBe(false);
    expect(parse({ roles: ['WIZARD'] }).success).toBe(false);
    expect(parse({ roles: ['TEACHER', 'WIZARD'] }).success).toBe(false);
    expect(parse({ roles: STAFF_ROLE_KEYS }).success).toBe(true);
  });
  it('title is optional and one of Mr, Mrs, Ms, Dr', () => {
    expect(parse({}).data?.title).toBeUndefined();
    expect(parse({ title: '' }).data?.title).toBeNull();
    for (const t of ['Mr', 'Mrs', 'Ms', 'Dr']) expect(parse({ title: t }).data?.title).toBe(t);
    expect(parse({ title: 'Prof' }).success).toBe(false);
    expect(parse({ title: 'mr' }).success).toBe(false);
  });
  it('sign-in is an invite or a temporary password', () => {
    expect(parse({ signIn: 'TEMP_PASSWORD' }).data?.signIn).toBe('TEMP_PASSWORD');
    expect(parse({ signIn: 'EMAIL_ME' }).success).toBe(false);
    expect(parse({ email: 'nope' }).success).toBe(false);
  });
  it('an edit needs at least one thing, and the same rules apply', () => {
    expect(SystemUpdateUserSchema.safeParse({}).success).toBe(false);
    expect(SystemUpdateUserSchema.safeParse({ title: '' }).success).toBe(true);
    expect(SystemUpdateUserSchema.safeParse({ phone: '12' }).success).toBe(false);
    expect(SystemUpdateUserSchema.safeParse({ roles: [] }).success).toBe(false);
    expect(SystemUpdateUserSchema.parse({ fullName: 'rudo chari' }).fullName).toBe('Rudo Chari');
  });
});

describe('status', () => {
  it('is deactivated, invited or active', () => {
    expect(statusOf({ active: false, invitePending: true })).toBe('deactivated');
    expect(statusOf({ active: false, invitePending: false })).toBe('deactivated');
    expect(statusOf({ active: true, invitePending: true })).toBe('invited');
    expect(statusOf({ active: true, invitePending: false })).toBe('active');
  });
});

describe('the list query', () => {
  const where = (qs: string) => userWhere(parseTableQuery(new URLSearchParams(qs), { sortable: ['fullName'], filterKeys: { role: (STAFF_ROLE_KEYS.length ? (SystemCreateUserSchema.shape.roles as never) : (null as never)) } }));
  it('filters on status', () => {
    const q = (qs: string) => userWhere({ q: '', sort: undefined, dir: 'asc', page: 1, pageSize: 25, filters: Object.fromEntries(new URLSearchParams(qs)) });
    expect(q('status=invited')).toMatchObject({ active: true, invitePending: true });
    expect(q('status=active')).toMatchObject({ active: true, invitePending: false });
    expect(q('status=deactivated')).toEqual({ active: false });
    expect(q('role=TEACHER')).toEqual({ staffRoles: { has: 'TEACHER' } });
    expect(q('')).toEqual({});
    expect(where).toBeTypeOf('function');
  });
  it('searches the phone however it is written', () => {
    const q = (text: string) => userWhere({ q: text, sort: undefined, dir: 'asc', page: 1, pageSize: 25, filters: {} });
    const phones = (text: string) => ((q(text).OR ?? []) as { phone?: { contains: string } }[]).filter((c) => c.phone).map((c) => c.phone!.contains);
    expect(phones('0771234567')).toContain('771234567');
    expect(phones('+263 77 123 4567')).toContain('771234567');
    expect(phones('77123')).toContain('77123');
    expect(phones('ab')).toEqual(['ab']);         // too short to be a number search
  });
});

describe('invite links', () => {
  it('last 72 hours, and a reset link 30 minutes', () => {
    expect(INVITE_TTL_MS).toBe(72 * 3600 * 1000);
    expect(RESET_TTL_MS).toBe(30 * 60 * 1000);
  });
  it('mark an invite for the page wording, and nothing else', () => {
    process.env.NEXTAUTH_URL = 'https://pfuma.test/';
    expect(resetUrl('abc')).toBe('https://pfuma.test/reset-password/abc');
    expect(resetUrl('abc', true)).toBe('https://pfuma.test/reset-password/abc?invite=1');
  });
});
