// @vitest-environment node
// Settings tabs 2 to 6 against a real database: years and terms, forms / streams / classes,
// grading scales, finance basics, numbering (and the admission numbers that use it).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { session } from '../helpers/session';
import { defaultRegistrationValues, currentYearInHarare } from '@/lib/students/registration';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
type Actor = { id: string; email: string; schoolId: string; role: 'ADMIN'; fullName: string };
let C: Actor; // a school with no years yet

const admin = () => A.users.ADMIN;
const auditCount = (schoolId: string, where: object = {}) => prisma.auditLog.count({ where: { schoolId, ...where } });
const dbOf = async (schoolId: string, userId: string) => (await import('@/lib/scoped-db')).getScopedDb(schoolId, userId);

beforeAll(async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  const school = await prisma.school.create({ data: { name: 'School C' } });
  const u = await prisma.user.create({ data: { schoolId: school.id, fullName: 'C Admin', email: 'admin@c.test', role: 'ADMIN', passwordHash: 'x' } });
  C = { id: u.id, email: u.email, schoolId: school.id, role: 'ADMIN', fullName: u.fullName };
  // Forms 2 to 6 for school A (the seed has Form 1).
  for (let order = 2; order <= 6; order++) {
    await prisma.level.create({ data: { schoolId: A.schoolId, name: `Form ${order}`, order, category: order >= 5 ? 'A_LEVEL' : 'O_LEVEL' } });
  }
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

// ─── Tab 2: years and terms ──────────────────────────────────────────────────

describe('academic years and terms', () => {
  const terms2027 = [
    { startDate: '2027-01-11', endDate: '2027-04-09' },
    { startDate: '2027-05-10', endDate: '2027-08-13' },
    { startDate: '2027-09-06', endDate: '2027-12-03' },
  ];
  const addYear = (body: object, as: object | null = C) => call('system/academic/years', 'POST', { as: as as never, body });
  const terms = async () => prisma.academicTerm.findMany({ where: { schoolId: C.schoolId }, orderBy: { startDate: 'asc' } });

  it('adds a year with its three terms and the dates chosen, all planned, and logs it', async () => {
    const r = await addYear({ year: 2027, terms: terms2027 });
    expect(r.status).toBe(201);
    const rows = await terms();
    expect(rows.map((x) => [x.name, x.status, x.startDate.toISOString().slice(0, 10), x.endDate.toISOString().slice(0, 10)])).toEqual([
      ['Term 1 2027', 'PLANNED', '2027-01-11', '2027-04-09'],
      ['Term 2 2027', 'PLANNED', '2027-05-10', '2027-08-13'],
      ['Term 3 2027', 'PLANNED', '2027-09-06', '2027-12-03'],
    ]);
    expect(await auditCount(C.schoolId, { action: 'CREATE_ACADEMIC_YEAR' })).toBe(1);
    const list = await call('system/academic/years', 'GET', { as: C as never });
    expect(list.json.data.years[0].terms).toHaveLength(3);
  });

  it('refuses a repeated year, overlapping terms, terms outside the year and wrong shapes', async () => {
    const before = await prisma.academicTerm.count({ where: { schoolId: C.schoolId } });
    expect((await addYear({ year: 2027, terms: terms2027 })).status).toBe(409);
    const bad: object[] = [
      { year: 2028, terms: [terms2027[0], terms2027[1]] },
      { year: 2028, terms: [{ startDate: '2028-01-10', endDate: '2028-05-20' }, { startDate: '2028-05-01', endDate: '2028-08-10' }, { startDate: '2028-09-05', endDate: '2028-12-01' }] },
      { year: 2028, terms: [{ startDate: '2028-01-10', endDate: '2028-04-10' }, { startDate: '2028-04-10', endDate: '2028-08-10' }, { startDate: '2028-09-05', endDate: '2028-12-01' }] },
      { year: 2028, terms: [{ startDate: '2027-12-20', endDate: '2028-04-10' }, { startDate: '2028-05-01', endDate: '2028-08-10' }, { startDate: '2028-09-05', endDate: '2028-12-01' }] },
      { year: 2028, terms: [{ startDate: '2028-01-10', endDate: '2028-04-10' }, { startDate: '2028-05-01', endDate: '2028-08-10' }, { startDate: '2028-09-05', endDate: '2029-01-10' }] },
      { year: 2028, terms: [{ startDate: '2028-04-10', endDate: '2028-01-10' }, { startDate: '2028-05-01', endDate: '2028-08-10' }, { startDate: '2028-09-05', endDate: '2028-12-01' }] },
      { year: 1999, terms: terms2027 }, { year: 'next', terms: terms2027 }, { terms: terms2027 },
    ];
    for (const b of bad) expect((await addYear(b)).status, JSON.stringify(b)).toBe(422);
    expect(await prisma.academicTerm.count({ where: { schoolId: C.schoolId } })).toBe(before);
  });

  it('refuses a year that overlaps another year', async () => {
    const { createAcademicYear } = await import('@/lib/academic/terms');
    await expect(createAcademicYear(C.schoolId, C.id, { year: 2028, startDate: '2027-11-01', endDate: '2028-06-30' })).rejects.toThrow(/overlaps the 2027/);
  });

  it('opens one term at a time, closes it, and keeps a closed term\'s dates', async () => {
    const [t1, t2] = await terms();
    const open = (id: string, as: object | null = C) => call('system/academic/terms/[id]/open', 'POST', { as: as as never, params: { id } });
    const close = (id: string, as: object | null = C) => call('system/academic/terms/[id]/close', 'POST', { as: as as never, params: { id } });

    expect((await close(t1.id)).status).toBe(409); // not open yet
    expect((await open(t1.id)).status).toBe(200);
    expect((await prisma.academicTerm.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('OPEN');
    expect(await auditCount(C.schoolId, { action: 'OPEN_TERM', entityId: t1.id })).toBe(1);

    const second = await open(t2.id);
    expect(second.status).toBe(409);
    expect(second.json.message).toMatch(/Close Term 1 2027 before opening/);
    expect(await prisma.academicTerm.count({ where: { schoolId: C.schoolId, status: 'OPEN' } })).toBe(1);
    expect((await open(t1.id)).status).toBe(409); // already open

    expect((await close(t1.id)).status).toBe(200);
    expect(await auditCount(C.schoolId, { action: 'CLOSE_TERM', entityId: t1.id })).toBe(1);
    expect((await close(t1.id)).status).toBe(409);
    expect((await open(t1.id)).status).toBe(409); // a closed term does not simply reopen
    expect((await call('system/academic/terms/[id]', 'PATCH', { as: C as never, params: { id: t1.id }, body: { startDate: '2027-01-12', endDate: '2027-04-09' } })).status).toBe(409);
    expect((await open(t2.id)).status).toBe(200);
  });

  it('changes the dates of a term that is not closed, and not into a neighbour', async () => {
    const [, t2, t3] = await terms();
    const patch = (id: string, body: object) => call('system/academic/terms/[id]', 'PATCH', { as: C as never, params: { id }, body });
    expect((await patch(t3.id, { startDate: '2027-08-01', endDate: '2027-12-03' })).status).toBe(422); // starts before Term 2 ends
    expect((await patch(t3.id, { startDate: '2027-12-10', endDate: '2027-12-03' })).status).toBe(422);
    expect((await patch(t3.id, { startDate: '2027-12-20', endDate: '2028-01-20' })).status).toBe(422); // leaves the year
    const ok = await patch(t3.id, { startDate: '2027-09-13', endDate: '2027-12-10' });
    expect(ok.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: C.schoolId, action: 'UPDATE_ACADEMIC_TERM', entityId: t3.id } });
    expect(entry.detail).toContain('2027-09-13');
    expect((await patch(t2.id, { startDate: '2027-05-10', endDate: '2027-08-20' })).status).toBe(200);
  });

  it('is refused to people without the permission, and to a school\'s foreign terms', async () => {
    const [t1] = await terms();
    for (const role of ['HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN'] as const) {
      expect((await addYear({ year: 2031, terms: terms2027 }, A.users[role])).status, role).toBe(403);
      expect((await call('system/academic/terms/[id]/open', 'POST', { as: A.users[role], params: { id: t1.id } })).status, role).toBe(403);
      expect((await call('system/academic/terms/[id]/close', 'POST', { as: A.users[role], params: { id: t1.id } })).status, role).toBe(403);
      expect((await call('system/academic/terms/[id]', 'PATCH', { as: A.users[role], params: { id: t1.id }, body: { startDate: '2027-01-12', endDate: '2027-04-09' } })).status, role).toBe(403);
    }
    expect((await addYear({ year: 2031, terms: terms2027 }, null)).status).toBe(401);
    for (const path of ['system/academic/terms/[id]/open', 'system/academic/terms/[id]/close'] as const) {
      expect((await call(path, 'POST', { as: admin(), params: { id: B.termId } })).status).toBe(404);
    }
    expect((await call('system/academic/terms/[id]', 'PATCH', { as: admin(), params: { id: B.termId }, body: { startDate: '2026-01-11', endDate: '2026-12-19' } })).status).toBe(404);
    expect((await prisma.academicTerm.findUniqueOrThrow({ where: { id: B.termId } })).status).toBe('OPEN');
  });

  it('is rolled back as a whole when a new year clashes with an open year\'s students (existing rule still applies)', async () => {
    // School A has a student enrolled in the open Term 1 2026; opening a new year's term needs an end-of-year decision first.
    const y = await call('system/academic/years', 'POST', { as: admin(), body: { year: 2027, terms: terms2027 } });
    expect(y.status).toBe(201);
    const next = await prisma.academicTerm.findFirstOrThrow({ where: { schoolId: A.schoolId, termNumber: 1, name: 'Term 1 2027' } });
    await call('system/academic/terms/[id]/close', 'POST', { as: admin(), params: { id: A.termId } });
    const r = await call('system/academic/terms/[id]/open', 'POST', { as: admin(), params: { id: next.id } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/no end-of-year decision/);
    // put the seeded school back the way the other tests expect it
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN', closedAt: null, closedById: null } });
  });
});

// ─── Tab 5 and 6: finance basics, numbering, admission numbers ───────────────

describe('finance basics', () => {
  const finance = { currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'USD', receiptFormat: 'RCP-{YEAR}-{000000}', receiptNextNumber: 1, invoiceFormat: 'INV-{YEAR}-{000000}', invoiceNextNumber: 1 };
  const save = (body: object, as: object | null = admin()) => call('system/settings/finance', 'PATCH', { as: as as never, body });

  it('saves currencies, which is shown first, and the formats, with before and after in the log', async () => {
    const n = await auditCount(A.schoolId, { action: 'UPDATE_FINANCE_SETTINGS' });
    const r = await save({ ...finance, defaultCurrency: 'ZIG', receiptFormat: 'RCP/{YY}/{0000}', receiptNextNumber: 25 });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({ currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'ZIG', receiptFormat: 'RCP/{YY}/{0000}', receiptNextNumber: 25 });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_FINANCE_SETTINGS' }, orderBy: { createdAt: 'desc' } });
    expect(entry.before).toMatchObject({ defaultCurrency: 'USD', receiptNextNumber: 1 });
    expect(entry.after).toMatchObject({ defaultCurrency: 'ZIG', receiptFormat: 'RCP/{YY}/{0000}', receiptNextNumber: 25 });
    expect(entry.detail).toMatch(/^Finance basics: changed defaultCurrency, receiptFormat, receiptNextNumber/);
    expect(await auditCount(A.schoolId, { action: 'UPDATE_FINANCE_SETTINGS' })).toBe(n + 1);
  });

  it('can switch one currency off, but not both, and the one shown first must be on', async () => {
    expect((await save({ ...finance, currencyZigEnabled: false, defaultCurrency: 'USD' })).status).toBe(200);
    expect((await save({ ...finance, currencyZigEnabled: false, defaultCurrency: 'ZIG' })).status).toBe(422);
    expect((await save({ ...finance, currencyUsdEnabled: false, currencyZigEnabled: false })).status).toBe(422);
    expect((await save({ ...finance, currencyUsdEnabled: false, defaultCurrency: 'ZIG' })).status).toBe(200);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } })).currencyUsdEnabled).toBe(false);
    expect((await save(finance)).status).toBe(200);
  });

  it('the database refuses what the form would have caught', async () => {
    await expect(prisma.school.update({ where: { id: A.schoolId }, data: { currencyUsdEnabled: false, currencyZigEnabled: false } })).rejects.toThrow();
    await expect(prisma.school.update({ where: { id: A.schoolId }, data: { currencyZigEnabled: false, defaultCurrency: 'ZIG' } })).rejects.toThrow();
    await expect(prisma.school.update({ where: { id: A.schoolId }, data: { admissionFormat: 'no counter' } })).rejects.toThrow();
    await expect(prisma.school.update({ where: { id: A.schoolId }, data: { schoolCode: 'lower' } })).rejects.toThrow();
  });

  it('rejects bad formats and numbers without changing anything', async () => {
    const before = await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } });
    const bad: object[] = [
      { receiptFormat: '' }, { receiptFormat: 'RCP-{YEAR}' }, { receiptFormat: '{0000}{000}' }, { receiptFormat: 'RCP#{0000}' }, { receiptFormat: '{NOPE}{0000}' }, { receiptFormat: 'x'.repeat(41) + '{0}' },
      { invoiceFormat: 'INVOICE' }, { receiptNextNumber: 0 }, { receiptNextNumber: 1.5 }, { receiptNextNumber: 1_000_000 }, { invoiceNextNumber: 'one' }, { defaultCurrency: 'EUR' },
    ];
    for (const b of bad) expect((await save({ ...finance, ...b })).status, JSON.stringify(b)).toBe(422);
    const after = await prisma.school.findUniqueOrThrow({ where: { id: A.schoolId } });
    expect([after.receiptFormat, after.receiptNextNumber, after.invoiceFormat]).toEqual([before.receiptFormat, before.receiptNextNumber, before.invoiceFormat]);
  });

  it('is for people who may change finance settings, and only in their own school', async () => {
    expect((await save(finance, A.users.HEAD)).status).toBe(403);
    expect((await save(finance, null)).status).toBe(401);
    const b = await prisma.school.findUniqueOrThrow({ where: { id: B.schoolId } });
    expect(b.receiptFormat).toBeNull();
  });
});

describe('numbering', () => {
  const save = (body: object, as: object | null = admin()) => call('system/settings/numbering', 'PATCH', { as: as as never, body });

  it('saves the school code and the admission format, logged', async () => {
    const r = await save({ schoolCode: ' chs ', admissionFormat: '{SCHOOLCODE}-{YY}-{000}' });
    expect(r.status).toBe(200);
    expect(r.json.data.school).toMatchObject({ schoolCode: 'CHS', admissionFormat: '{SCHOOLCODE}-{YY}-{000}' });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_NUMBERING' } });
    expect(entry.before).toMatchObject({ schoolCode: 'STU', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}' });
    expect(entry.after).toMatchObject({ schoolCode: 'CHS' });
  });

  it('rejects a bad code or format', async () => {
    for (const b of [{ schoolCode: '' }, { schoolCode: 'WAYTOOLONG' }, { schoolCode: 'A B' }, { admissionFormat: '{YEAR}' }, { admissionFormat: '{SCHOOLCODE}{YEAR}{0000}{000}' }, { admissionFormat: 'A$B{0000}' }]) {
      expect((await save({ schoolCode: 'CHS', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}', ...b })).status, JSON.stringify(b)).toBe(422);
    }
    expect((await save({ schoolCode: 'CHS', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}' }, A.users.TEACHER)).status).toBe(403);
    expect((await prisma.school.findUniqueOrThrow({ where: { id: B.schoolId } })).schoolCode).toBe('STU');
  });

  it('numbers the next admission from the highest one already used in that year', async () => {
    const { nextSequences, takeAdmissionNumber } = await import('@/lib/students/server');
    const db = await dbOf(A.schoolId, admin().id);
    const make = (n: string) => prisma.student.create({ data: { schoolId: A.schoolId, admissionNumber: n, firstName: 'N', surname: n, fullName: `N ${n}`, admissionDate: new Date('2026-02-01'), currentClassId: A.classId } });
    await make('CHS-26-005');
    await make('CHS-26-002');
    await make('CHS-25-099');      // another year
    await make('STU20260050');     // the old format: not counted
    const seq = await nextSequences(db as never, A.schoolId, [2026, 2027]);
    expect(seq.get(2026)).toBe(6);
    expect(seq.get(2027)).toBe(1);
    expect(takeAdmissionNumber(seq, 2026)).toBe('CHS-26-006');
    expect(takeAdmissionNumber(seq, 2026)).toBe('CHS-26-007');
    expect(takeAdmissionNumber(seq, 2027)).toBe('CHS-27-001');
    // another school is not affected
    const other = await nextSequences((await dbOf(B.schoolId, B.users.ADMIN.id)) as never, B.schoolId, [2026]);
    expect(other.get(2026)).toBe(3); // B's own seeded student is STU20260002; A's numbers are not counted
  });

  it('admitting a student really uses the format', async () => {
    const year = currentYearInHarare();
    await save({ schoolCode: 'CHS', admissionFormat: '{SCHOOLCODE}{YY}/{0000}' });
    const body = {
      student: {
        ...defaultRegistrationValues(),
        firstName: 'Rudo', surname: 'Ncube', gender: 'F', dateOfBirth: `${year - 13}-03-05`, level: 'Form 1', stream: 'North',
        guardianName: 'Mai Ncube', guardianRelationship: 'MOTHER', guardianPhone: '0771234567', houseNumber: '12', suburb: 'Mbare', city: 'Harare',
      },
    };
    const r = await call('admin/students', 'POST', { as: admin(), body });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.data.student.admissionNumber).toBe(`CHS${String(year).slice(-2)}/0001`);
    const again = await call('admin/students', 'POST', { as: admin(), body: { student: { ...body.student, firstName: 'Tino', surname: 'Dube' } } });
    expect(again.json.data.student.admissionNumber).toBe(`CHS${String(year).slice(-2)}/0002`);
  });
});

describe('small defaults', () => {
  it('saves the class capacity on its own, and logs it', async () => {
    const r = await call('system/settings/defaults', 'PATCH', { as: admin(), body: { maxClassSize: 42 } });
    expect(r.status).toBe(200);
    expect(r.json.data.school.maxClassSize).toBe(42);
    expect((await call('system/settings/defaults', 'PATCH', { as: admin(), body: { maxClassSize: 0 } })).status).toBe(422);
    expect((await call('system/settings/defaults', 'PATCH', { as: admin(), body: {} })).status).toBe(422);
    await call('system/settings/defaults', 'PATCH', { as: admin(), body: { maxClassSize: 45 } });
  });
});

// ─── Tab 4: grading ──────────────────────────────────────────────────────────

describe('grading scales', () => {
  const O = [
    { letterGrade: 'A', minPercent: 75, maxPercent: 100, points: null, remark: 'Excellent' },
    { letterGrade: 'B', minPercent: 60, maxPercent: 74, points: null, remark: 'Very good' },
    { letterGrade: 'C', minPercent: 50, maxPercent: 59, points: null, remark: 'Good' },
    { letterGrade: 'D', minPercent: 40, maxPercent: 49, points: null, remark: 'Satisfactory' },
    { letterGrade: 'E', minPercent: 30, maxPercent: 39, points: null, remark: 'Weak' },
    { letterGrade: 'U', minPercent: 0, maxPercent: 29, points: null, remark: 'Ungraded' },
  ];
  const Alevel = [
    { letterGrade: 'A', minPercent: 80, maxPercent: 100, points: 5 }, { letterGrade: 'B', minPercent: 70, maxPercent: 79, points: 4 },
    { letterGrade: 'C', minPercent: 60, maxPercent: 69, points: 3 }, { letterGrade: 'D', minPercent: 50, maxPercent: 59, points: 2 },
    { letterGrade: 'E', minPercent: 40, maxPercent: 49, points: 1 }, { letterGrade: 'U', minPercent: 0, maxPercent: 39, points: 0 },
  ];
  const put = (category: string, rows: object[], as: object | null = admin()) => call('system/grading/[category]', 'PUT', { as: as as never, params: { category }, body: { rows } });

  it('starts from the older school-wide scale, or the standard one, and says which', async () => {
    const mine = (await call('system/grading', 'GET', { as: admin() })).json.data.scales;
    expect(mine.map((s: { category: string; source: string }) => [s.category, s.source])).toEqual([['O_LEVEL', 'school-wide'], ['A_LEVEL', 'school-wide']]); // the seed has a school-wide set
    const fresh = (await call('system/grading', 'GET', { as: C as never })).json.data.scales;
    expect(fresh.map((s: { source: string }) => s.source)).toEqual(['default', 'default']);
    expect(fresh[0].rows.map((r: { letterGrade: string; minPercent: number }) => `${r.letterGrade}${r.minPercent}`)).toEqual(['A75', 'B60', 'C50', 'D40', 'E30', 'U0']);
    expect(fresh[1].rows.slice(0, 5).map((r: { points: number }) => r.points)).toEqual([5, 4, 3, 2, 1]);
  });

  it('saves the O Level scale with remarks and logs it', async () => {
    const r = await put('O_LEVEL', O);
    expect(r.status).toBe(200);
    expect(r.json.data.scale).toMatchObject({ category: 'O_LEVEL', source: 'saved' });
    const rows = await prisma.gradeBoundary.findMany({ where: { schoolId: A.schoolId, category: 'O_LEVEL' }, orderBy: { minPercent: 'desc' } });
    expect(rows.map((x) => [x.letterGrade, x.minPercent.toNumber(), x.maxPercent.toNumber(), x.remark, x.levelId, x.termId])).toEqual(O.map((x) => [x.letterGrade, x.minPercent, x.maxPercent, x.remark, null, null]));
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'UPDATE_GRADING', entityId: 'O_LEVEL' } });
    expect(entry.before).toMatchObject({ source: 'school-wide' });
    expect(entry.after).toMatchObject({ source: 'saved' });
    expect(entry.detail).toContain('A 75–100');
  });

  it('keeps A Level points, and needs them', async () => {
    expect((await put('A_LEVEL', Alevel.map(({ points: _p, ...rest }) => rest))).status).toBe(422); // eslint-disable-line @typescript-eslint/no-unused-vars
    const r = await put('A_LEVEL', Alevel);
    expect(r.status).toBe(200);
    expect(r.json.data.scale.rows.slice(0, 5).map((x: { points: number }) => x.points)).toEqual([5, 4, 3, 2, 1]);
  });

  it('refuses gaps, overlaps, a scale that does not reach 0 and 100, and repeated grades', async () => {
    const before = await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId, category: 'O_LEVEL' } });
    const tweak = (i: number, change: object) => O.map((r, j) => (j === i ? { ...r, ...change } : r));
    const bad: [string, object[]][] = [
      ['gap', tweak(1, { maxPercent: 72 })], ['overlap', tweak(1, { maxPercent: 76 })], ['no zero', tweak(5, { minPercent: 5 })], ['no hundred', tweak(0, { maxPercent: 95 })],
      ['repeat', tweak(1, { letterGrade: 'A' })], ['one grade', O.slice(0, 1)], ['over 100', tweak(0, { maxPercent: 101 })], ['blank grade', tweak(0, { letterGrade: '' })],
      ['long remark', tweak(0, { remark: 'x'.repeat(61) })], ['negative points', tweak(0, { points: -1 })],
    ];
    for (const [name, rows] of bad) expect((await put('O_LEVEL', rows)).status, name).toBe(422);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId, category: 'O_LEVEL' } })).toBe(before);
    expect((await put('Z_LEVEL', O)).status).toBe(404);
  });

  it('is left alone by the older grade-boundaries page, and leaves it alone', async () => {
    const legacy = await call('results/grade-boundaries', 'GET', { as: A.users.HEAD });
    expect(legacy.json.data.boundaries.every((b: { category: unknown }) => b.category === null)).toBe(true);
    const saved = await call('results/grade-boundaries', 'POST', { as: A.users.HEAD, body: { boundaries: [{ minPercent: 0, maxPercent: 100, letterGrade: 'Z' }] } });
    expect(saved.status).toBe(200);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId, category: 'O_LEVEL' } })).toBe(O.length);
    await call('results/grade-boundaries', 'POST', { as: A.users.HEAD, body: { boundaries: [{ minPercent: 0, maxPercent: 100, letterGrade: 'A' }] } });
  });

  it('is what grades marks for that category, ahead of the school-wide set', async () => {
    const { boundariesFor, gradeFor } = await import('@/lib/results');
    const rows = (await prisma.gradeBoundary.findMany({ where: { schoolId: A.schoolId } })).map((b) => ({
      minPercent: b.minPercent.toNumber(), maxPercent: b.maxPercent.toNumber(), letterGrade: b.letterGrade, levelId: b.levelId, termId: b.termId, category: b.category,
    }));
    expect(gradeFor(80, boundariesFor(rows, A.levelId, A.termId, 'O_LEVEL'))?.letterGrade).toBe('A');
    expect(gradeFor(45, boundariesFor(rows, A.levelId, A.termId, 'O_LEVEL'))?.letterGrade).toBe('D');
    expect(gradeFor(45, boundariesFor(rows, A.levelId, A.termId, 'A_LEVEL'))?.letterGrade).toBe('E');
    expect(gradeFor(45, boundariesFor(rows, A.levelId, A.termId, null))?.letterGrade).toBe('A'); // the school-wide set from the seed
  });

  it('is for people who may change grading, and each school has its own', async () => {
    expect((await put('O_LEVEL', O, A.users.HEAD)).status).toBe(403);
    expect((await put('O_LEVEL', O, null)).status).toBe(401);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: B.schoolId, category: { not: null } } })).toBe(0);
  });
});

// ─── Tab 3: forms, streams, classes ──────────────────────────────────────────

describe('forms, streams and classes', () => {
  const api = {
    forms: (forms: { id: string; active: boolean }[], as: object | null = admin()) => call('system/structure/forms', 'PATCH', { as: as as never, body: { forms } }),
    addStream: (name: string, as: object | null = admin()) => call('system/structure/streams', 'POST', { as: as as never, body: { name } }),
    grid: (cells: object[], as: object | null = admin()) => call('system/structure/classes', 'PUT', { as: as as never, body: { cells } }),
  };
  const levelId = async (name: string) => (await prisma.level.findFirstOrThrow({ where: { schoolId: A.schoolId, name } })).id;
  const cell = (levelId: string, stream: string, exists = true, capacity = 40) => ({ levelId, stream, exists, capacity });
  const klass = (name: string) => prisma.schoolClass.findFirst({ where: { schoolId: A.schoolId, name } });

  it('reads the forms, streams and classes with the number of students', async () => {
    const r = await call('system/structure', 'GET', { as: admin() });
    expect(r.status).toBe(200);
    expect(r.json.data.levels.map((l: { name: string }) => l.name)).toEqual(['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6']);
    expect(r.json.data.levels.every((l: { active: boolean }) => l.active)).toBe(true);
    const north = r.json.data.classes.find((c: { name: string }) => c.name === 'Form 1 North');
    expect(north).toMatchObject({ studentsNow: 3, studentsEver: 3, active: true });
  });

  it('keeps a list of streams, one spelling each', async () => {
    expect((await api.addStream('north')).status).toBe(201);
    expect((await api.addStream('NORTH')).status).toBe(409);
    expect((await api.addStream('  south ')).status).toBe(201);
    expect((await api.addStream('East')).status).toBe(201);
    for (const bad of ['', '   ', 'x'.repeat(31), 'North<script>', 'East-1']) expect((await api.addStream(bad)).status, bad).toBe(422);
    const names = (await prisma.stream.findMany({ where: { schoolId: A.schoolId }, orderBy: { name: 'asc' } })).map((s) => s.name);
    expect(names).toEqual(['East', 'North', 'South']);
    expect(await auditCount(A.schoolId, { action: 'UPDATE_STREAMS' })).toBe(3);
    expect((await api.addStream('Blue', A.users.HEAD)).status).toBe(403);
  });

  it('builds classes from the grid: named automatically, with the capacity chosen', async () => {
    const [f1, f2, f5] = [await levelId('Form 1'), await levelId('Form 2'), await levelId('Form 5')];
    const r = await api.grid([cell(f1, 'North', true, 38), cell(f1, 'South', true, 40), cell(f2, 'North', true, 45), cell(f2, 'east', true, 30), cell(f5, 'North', true, 25)]);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data).toMatchObject({ created: 4, updated: 1, archived: 0, deleted: 0 });
    expect((await klass('Form 1 North'))?.capacity).toBe(38);          // the existing class is changed, not duplicated
    expect(await prisma.schoolClass.count({ where: { schoolId: A.schoolId, levelId: f1, stream: 'North' } })).toBe(1);
    expect((await klass('Form 1 South'))?.capacity).toBe(40);
    expect((await klass('Form 2 East'))?.capacity).toBe(30);           // spelt the way the stream list spells it
    expect((await klass('Form 5 North'))?.capacity).toBe(25);
    expect(await auditCount(A.schoolId, { action: 'CREATE_CLASS' })).toBeGreaterThanOrEqual(4);
    expect(await auditCount(A.schoolId, { action: 'UPDATE_CLASS', entityId: A.classId })).toBe(1);
  });

  it('refuses a bad grid and changes nothing at all', async () => {
    const [f1, f3] = [await levelId('Form 1'), await levelId('Form 3')];
    const before = await prisma.schoolClass.count({ where: { schoolId: A.schoolId } });
    // the first cell is fine; the second names a stream the school does not have
    expect((await api.grid([cell(f3, 'North'), cell(f3, 'Purple')])).status).toBe(404);
    expect((await api.grid([cell(B.levelId, 'North')])).status).toBe(404);                 // another school's form
    expect((await api.grid([cell(f3, 'North'), cell(f3, 'north')])).status).toBe(422);     // the same class twice
    for (const bad of [{ capacity: 0 }, { capacity: 201 }, { capacity: 12.5 }, { capacity: '45' }]) expect((await api.grid([{ ...cell(f3, 'North'), ...bad }])).status, JSON.stringify(bad)).toBe(422);
    expect((await api.grid([])).status).toBe(422);
    // removing a class that has students in the open term
    const stuck = await api.grid([cell(f3, 'North'), cell(f1, 'North', false)]);
    expect(stuck.status).toBe(409);
    expect(stuck.json.message).toMatch(/Form 1 North has 3 students/);
    expect(await prisma.schoolClass.count({ where: { schoolId: A.schoolId } })).toBe(before);   // Form 3 North was not created either
    expect((await klass('Form 1 North'))?.active).toBe(true);
    expect((await api.grid([cell(f1, 'North')], A.users.TEACHER)).status).toBe(403);
  });

  it('deletes a class that never had anything, and archives one with history', async () => {
    const [f1, f2] = [await levelId('Form 1'), await levelId('Form 2')];
    // Form 2 East never had students: it is deleted.
    const del = await api.grid([cell(f2, 'East', false)]);
    expect(del.json.data).toMatchObject({ deleted: 1, archived: 0 });
    expect(await klass('Form 2 East')).toBeNull();
    expect(await auditCount(A.schoolId, { action: 'DELETE_CLASS' })).toBe(1);

    // Form 1 South gets a student in an earlier (closed) term, so it has a history.
    const south = (await klass('Form 1 South'))!;
    const oldYear = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2025, startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31') } });
    const old = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: oldYear.id, termNumber: 1, name: 'Term 1 2025', startDate: new Date('2025-01-10'), endDate: new Date('2025-04-10'), status: 'CLOSED' } });
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: A.studentId, classId: south.id, termId: old.id, startDate: new Date('2025-01-10'), status: 'PROMOTED' } });
    const arch = await api.grid([cell(f1, 'South', false)]);
    expect(arch.json.data).toMatchObject({ archived: 1, deleted: 0 });
    const archived = (await klass('Form 1 South'))!;
    expect(archived.active).toBe(false);                                   // still there, with its history
    expect(await prisma.enrollment.count({ where: { classId: south.id } })).toBe(1);
    expect(await auditCount(A.schoolId, { action: 'ARCHIVE_CLASS', entityId: south.id })).toBe(1);
  });

  it('brings an archived class back when it is ticked again', async () => {
    const f1 = await levelId('Form 1');
    const r = await api.grid([cell(f1, 'South', true, 36)]);
    expect(r.json.data).toMatchObject({ restored: 1, created: 0 });
    expect(await klass('Form 1 South')).toMatchObject({ active: true, capacity: 36 });
  });

  it('renames a stream and its classes follow; a clash or a stream in use cannot be removed', async () => {
    const east = (await prisma.stream.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'East' } })).id;
    const south = (await prisma.stream.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'South' } })).id;
    const north = (await prisma.stream.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'North' } })).id;
    const rename = (id: string, name: string, as: object | null = admin()) => call('system/structure/streams/[id]', 'PATCH', { as: as as never, params: { id }, body: { name } });
    const remove = (id: string, as: object | null = admin()) => call('system/structure/streams/[id]', 'DELETE', { as: as as never, params: { id } });

    expect((await rename(south, 'Blue')).status).toBe(200);
    expect(await klass('Form 1 Blue')).toMatchObject({ stream: 'Blue', active: true });
    expect(await klass('Form 1 South')).toBeNull();
    expect((await rename(south, 'north')).status).toBe(409);                        // the same as another stream
    expect((await rename(north, '')).status).toBe(422);
    expect((await remove(north)).status).toBe(409);                                  // classes use it
    expect((await remove(east)).status).toBe(200);                                   // nothing uses it (Form 2 East was deleted)
    expect(await prisma.stream.count({ where: { id: east } })).toBe(0);
    expect((await remove(east)).status).toBe(404);
    expect((await rename(B.users.ADMIN.id, 'Hacked')).status).toBe(404);
    expect((await rename(south, 'Green', A.users.HEAD)).status).toBe(403);
    expect(await auditCount(A.schoolId, { action: 'UPDATE_STREAMS', detail: { contains: 'Renamed South to Blue' } })).toBe(1);
  });

  it('switches forms off: archives their classes, keeps the history, and refuses while students are in them', async () => {
    const all = (await prisma.level.findMany({ where: { schoolId: A.schoolId }, orderBy: { order: 'asc' } })).map((l) => ({ id: l.id, active: l.active }));
    const set = (offIds: string[]) => all.map((l) => ({ id: l.id, active: !offIds.includes(l.id) }));
    const [f1, f5, f6] = [await levelId('Form 1'), await levelId('Form 5'), await levelId('Form 6')];

    const withStudents = await api.forms(set([f1]));
    expect(withStudents.status).toBe(409);
    expect(withStudents.json.message).toMatch(/Form 1 has 3 students/);
    expect((await api.forms(all.map((l) => ({ id: l.id, active: false })))).status).toBe(422);          // at least one form stays on
    expect((await api.forms([{ id: B.levelId, active: false }])).status).toBe(404);

    const r = await api.forms(set([f5, f6]));
    expect(r.status).toBe(200);
    expect(r.json.data.levels.filter((l: { active: boolean }) => !l.active).map((l: { name: string }) => l.name)).toEqual(['Form 5', 'Form 6']);
    expect(await klass('Form 5 North')).toMatchObject({ active: false });                                  // archived, not deleted
    expect(await auditCount(A.schoolId, { action: 'UPDATE_FORMS' })).toBe(1);
    expect(await auditCount(A.schoolId, { action: 'ARCHIVE_CLASS', detail: { contains: 'Form 5 switched off' } })).toBe(1);

    // A form that is off offers no classes, through the grid or through admission.
    expect((await api.grid([cell(f5, 'North')])).status).toBe(409);
    const { findOrCreateClass } = await import('@/lib/students/server');
    const db = await dbOf(A.schoolId, admin().id);
    await expect(db.$tx((tx) => findOrCreateClass(tx, A.schoolId, admin().id, 'Form 6', 'East'))).rejects.toThrow(/switched off/);

    expect((await api.forms(set([]))).status).toBe(200);                                                     // switching them back on
    expect((await prisma.level.findFirstOrThrow({ where: { id: f5 } })).active).toBe(true);
    expect((await klass('Form 5 North'))?.active).toBe(false);                                              // classes stay archived until ticked
    expect((await api.forms(set([f6]), A.users.BURSAR)).status).toBe(403);
  });
});

// ─── The page ────────────────────────────────────────────────────────────────

describe('the settings page', () => {
  const render = async (as: object, tab?: string) => {
    session.current = { ...as };
    const mod = await import('@/app/(dashboard)/system/settings/page');
    return mod.default({ searchParams: { tab } });
  };

  it('shows each of the six tabs to an administrator', async () => {
    for (const tab of [undefined, 'profile', 'years', 'structure', 'grading', 'finance', 'numbering', 'bogus']) {
      expect(await render(admin(), tab), String(tab)).toBeTruthy();
    }
  });

  it('shows access denied without the permission, and passes the right flags to read-only people', async () => {
    const denied = (await render(A.users.TEACHER, 'years')) as { type: { name: string } };
    expect(denied.type.name).toBe('AccessDenied');
    await prisma.rolePermission.create({ data: { schoolId: A.schoolId, role: 'BURSAR', permission: 'system.settings.view' } });
    const readOnly = (await render(A.users.BURSAR, 'years')) as { props: { children: { props: { children?: { props?: Record<string, unknown> } } }[] } };
    const tabProps = readOnly.props.children[2].props.children?.props ?? {};
    expect([tabProps.canCreate, tabProps.canUpdate, tabProps.canOpen, tabProps.canClose]).toEqual([false, false, false, false]);
    await prisma.rolePermission.deleteMany({ where: { schoolId: A.schoolId } });
  });
});
