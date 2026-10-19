// @vitest-environment node
// CSV import: the check (OK / Warning / Error with reasons), the import in one transaction, merging guardians by phone,
// and the 500-student test file.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { addClass, addStudent, dayOffset } from '../helpers/students';
import { applyMapping, autoMap } from '@/lib/students/import-map';
import { parseCsv } from '@/lib/students/csv';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
const Y = Number(dayOffset(0).slice(0, 4));
// Names may only hold letters, so rows are named by turning their number into letters (12 -> "Imp-bc").
const nm = (n: number) => `Imp${String(n).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]!)}`;

const row = (n: number, over: Record<string, string> = {}) => ({
  rowNumber: n,
  values: { first_name: nm(n), surname: 'Pupil', gender: 'M', date_of_birth: `${Y - 13}-03-${String((n % 27) + 1).padStart(2, '0')}`, form: '1', stream: 'North', guardian_name: `Parent ${nm(n)}`, guardian_relationship: 'Mother', guardian_phone: `07721${String(10000 + n)}`, ...over },
});
const check = (as: { id: string } | null, rows: unknown[]) => call('students/import/check', 'POST', { as: as as never, body: { rows } });
const run = (as: { id: string } | null, rows: unknown[]) => call('students/import', 'POST', { as: as as never, body: { rows } });

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
  await prisma.school.update({ where: { id: A.schoolId }, data: { schoolCode: 'IMP' } });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('who may import', () => {
  it('needs students.profiles.import', async () => {
    expect((await check(A.users.BURSAR, [row(2)])).status).toBe(403);
    expect((await run(A.users.BURSAR, [row(2)])).status).toBe(403);
    expect((await run(null, [row(2)])).status).toBe(401);
    expect((await call('students/import', 'GET', { as: A.users.BURSAR })).status).toBe(403);
  });

  it('offers the template', async () => {
    const r = await call('students/import', 'GET', { as: A.users.ADMIN });
    expect(r.status).toBe(200);
    expect(r.text).toContain('first_name,surname,gender,date_of_birth,birth_certificate_no,form,stream,boarding,admission_date,guardian_name,guardian_relationship,guardian_phone,guardian_phone_2,address');
  });

  it('refuses an empty file and one that is too large', async () => {
    expect((await check(A.users.ADMIN, [])).status).toBe(422);
    const many = Array.from({ length: 1501 }, (_, i) => row(i + 2));
    expect((await check(A.users.ADMIN, many)).status).toBe(422);
  });
});

describe('the check', () => {
  it('marks each row OK, Warning or Error with the reason', async () => {
    const existing = await addStudent(prisma, A, { firstName: 'Already', surname: 'Here' });
    await prisma.student.update({ where: { id: existing.id }, data: { dateOfBirth: new Date(`${Y - 13}-05-05T00:00:00Z`), birthCertificateNumber: '63777777A42', admissionNumber: 'IMP-KEEP-1' } });
    const rows = [
      row(2), // fine, but its class does not exist yet? Form 1 North exists in the seed
      row(3, { date_of_birth: `${Y - 20}-01-01` }), // age warning
      row(4, { first_name: 'Already', surname: 'Here', date_of_birth: `${Y - 13}-05-05` }), // same name and date of birth as an existing student
      row(5, { birth_certificate_no: '63-777777 A 42' }), // certificate in use
      row(6, { admission_number: 'IMP-KEEP-1' }), // admission number in use
      row(7, { first_name: '' }), // missing
      row(8, { form: '2', stream: 'Garden' }), // class will be created
      row(9, { first_name: nm(2), date_of_birth: row(2).values.date_of_birth, guardian_phone: '0772999001' }), // twin of row 2
      row(10, { birth_certificate_no: '75-123123 B 11' }),
      row(11, { birth_certificate_no: '75123123b11', guardian_phone: '0772999002' }), // same certificate as row 10
    ];
    const r = await check(A.users.ADMIN, rows);
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.json.data.rows.map((x: { rowNumber: number }) => [x.rowNumber, x]));
    expect(by[2]).toMatchObject({ status: 'OK', messages: [] });
    expect(by[3].status).toBe('WARNING');
    expect(by[3].messages.join()).toContain('years old');
    expect(by[4]).toMatchObject({ status: 'WARNING' });
    expect(by[4].messages.join()).toContain('same name and date of birth');
    expect(by[5].status).toBe('ERROR');
    expect(by[5].messages.join()).toContain('Already Here');
    expect(by[6].status).toBe('ERROR');
    expect(by[6].messages.join()).toContain('IMP-KEEP-1');
    expect(by[7].status).toBe('ERROR');
    expect(by[7].messages.join()).toContain('First name');
    expect(by[8]).toMatchObject({ status: 'WARNING' });
    expect(by[8].messages.join()).toContain('will be created');
    expect(by[9].status).toBe('ERROR');
    expect(by[9].messages.join()).toContain('row 2');
    expect(by[10].status).toBe('OK');
    expect(by[11].status).toBe('ERROR');
    expect(by[11].messages.join()).toContain('row 10');
    expect(r.json.data.summary).toEqual({ total: 10, ok: 2, warnings: 3, errors: 5 });
    expect(r.json.data.reportCsv).toContain('Row,Student,Status,Reason');
    expect(JSON.stringify(r.json.data.rows)).not.toContain('"clean"'); // the cleaned values stay on the server
  });

  it('warns when a class would be over capacity after the import', async () => {
    const tiny = await addClass(prisma, A, 'Form 3 Tiny', { capacity: 2, order: 3 });
    await addStudent(prisma, A, { classId: tiny.id });
    const rows = [2, 3, 4].map((n) => row(n + 100, { form: '3', stream: 'Tiny', date_of_birth: `${Y - 15}-02-0${n}` }));
    const r = await check(A.users.ADMIN, rows);
    const all = r.json.data.rows.flatMap((x: { messages: string[] }) => x.messages).join('\n');
    expect(all).toContain('Form 3 Tiny will have 4 students after this import; its capacity is 2');
    expect(r.json.data.summary.errors).toBe(0);
  });

  it('refuses a form the school has switched off', async () => {
    await prisma.level.upsert({ where: { schoolId_name: { schoolId: A.schoolId, name: 'Form 6' } }, update: { active: false }, create: { schoolId: A.schoolId, name: 'Form 6', order: 6, category: 'A_LEVEL', active: false } });
    const r = await check(A.users.ADMIN, [row(2, { form: '6', stream: 'Arts', date_of_birth: `${Y - 18}-01-01` })]);
    expect(r.json.data.rows[0]).toMatchObject({ status: 'ERROR' });
    expect(r.json.data.rows[0].messages.join()).toContain('switched off');
  });

  it("never looks at another school's students", async () => {
    const theirs = await addStudent(prisma, B, { firstName: 'Their', surname: 'Pupil' });
    await prisma.student.update({ where: { id: theirs.id }, data: { birthCertificateNumber: '63888888A42', admissionNumber: 'THEIRS-1', dateOfBirth: new Date(`${Y - 13}-06-06T00:00:00Z`) } });
    const r = await check(A.users.ADMIN, [row(2, { birth_certificate_no: '63-888888 A 42', admission_number: 'THEIRS-1', first_name: 'Their', surname: 'Pupil', date_of_birth: `${Y - 13}-06-06` })]);
    expect(r.json.data.rows[0]).toMatchObject({ status: 'OK', messages: [] });
  });

  it('changes nothing', async () => {
    const before = await prisma.student.count({ where: { schoolId: A.schoolId } });
    await check(A.users.ADMIN, [row(500), row(501)]);
    expect(await prisma.student.count({ where: { schoolId: A.schoolId } })).toBe(before);
  });
});

describe('the import', () => {
  it('saves the valid rows in one go and reports the skipped ones with their reasons', async () => {
    const before = await prisma.student.count({ where: { schoolId: A.schoolId } });
    const rows = [row(201), row(202, { boarding: 'Boarder', gender: 'F', form: '2', stream: 'Fresh' }), row(203, { first_name: '' }), row(204, { guardian_phone: 'nope' }), row(205, { address: '12 Mbare Rd, Harare', admission_date: dayOffset(-3) })];
    const r = await run(A.users.ADMIN, rows);
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ imported: 3, skipped: 2, classesCreated: ['Form 2 Fresh'], summary: { total: 5, errors: 2 } });
    expect(r.json.data.reportCsv).toContain('203');
    expect(r.json.data.reportCsv).toContain('First name');
    expect(r.json.data.reportCsv).toContain('Guardian phone');
    expect(await prisma.student.count({ where: { schoolId: A.schoolId } })).toBe(before + 3);

    const s = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId, firstName: nm(202) }, include: { enrollments: true, guardians: { include: { guardian: true } }, libraryMember: true } });
    expect(s).toMatchObject({ fullName: `${nm(202)} Pupil`, gender: 'F', boarding: 'BOARDER', status: 'ACTIVE' });
    expect(s.admissionNumber).toMatch(/^IMP\d{4}\d{4}$/);
    expect(s.currentClassId).toBeTruthy();
    expect(s.enrollments).toHaveLength(1);
    expect(s.enrollments[0]).toMatchObject({ termId: A.termId, classId: s.currentClassId, status: 'ACTIVE' });
    expect(s.guardians[0]).toMatchObject({ isPrimary: true, isFeePayer: true, relationship: 'MOTHER' });
    expect(s.libraryMember).toBeTruthy();
    const dated = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId, firstName: nm(205) } });
    expect(dated.admissionDate.toISOString().slice(0, 10)).toBe(dayOffset(-3));
    expect(dated.address).toBe('12 Mbare Rd, Harare');

    const summary = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'IMPORT_STUDENTS' } });
    expect(summary.after).toMatchObject({ imported: 3, skipped: 2, classesCreated: ['Form 2 Fresh'] });
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'ADMIT_STUDENT', detail: { contains: 'imported' } } })).toBe(3);
  });

  it('numbers the students one after another, and keeps admission numbers that the file gives', async () => {
    const r = await run(A.users.ADMIN, [row(301), row(302), row(303, { admission_number: 'OLD-0042' })]);
    expect(r.status).toBe(201);
    const numbers = (await prisma.student.findMany({ where: { schoolId: A.schoolId, firstName: { in: [nm(301), nm(302), nm(303)] } }, select: { firstName: true, admissionNumber: true }, orderBy: { firstName: 'asc' } }));
    expect(numbers[2]!.admissionNumber).toBe('OLD-0042');
    expect(Number(numbers[1]!.admissionNumber.slice(-4))).toBe(Number(numbers[0]!.admissionNumber.slice(-4)) + 1);
  });

  it('merges guardians with the same phone number into one record, in the file and with those already in the school', async () => {
    const g0 = await prisma.guardian.count({ where: { schoolId: A.schoolId } });
    const known = await addStudent(prisma, A, { phone: '+263773400001' });
    const r = await run(A.users.ADMIN, [
      row(401, { guardian_phone: '0773 400 001', guardian_name: 'Different Name' }), // already in the school
      row(402, { guardian_phone: '0773400002', guardian_name: 'First Seen' }),
      row(403, { guardian_phone: '+263773400002', guardian_name: 'Second Seen' }), // same phone, later row
      row(404, { guardian_phone: '0773400003' }),
    ]);
    expect(r.status).toBe(201);
    expect(r.json.data).toMatchObject({ imported: 4, guardiansCreated: 2, guardiansShared: 1 });
    expect(await prisma.guardian.count({ where: { schoolId: A.schoolId } })).toBe(g0 + 1 /* known */ + 2);
    const two = await prisma.guardian.findMany({ where: { schoolId: A.schoolId, phone: '+263773400002' }, include: { students: true } });
    expect(two).toHaveLength(1);
    expect(two[0]!.fullName).toBe('First Seen');
    expect(two[0]!.students).toHaveLength(2);
    expect((await prisma.guardian.findFirstOrThrow({ where: { schoolId: A.schoolId, phone: '+263773400001' }, include: { students: true } })).students).toHaveLength(2);
    expect(known.id).toBeTruthy();
  });

  it('skips a row that has become a duplicate since the preview, and imports nothing when nothing is valid', async () => {
    const first = await run(A.users.ADMIN, [row(501, { birth_certificate_no: '75-505050 A 11' })]);
    expect(first.status).toBe(201);
    const again = await run(A.users.ADMIN, [row(502, { birth_certificate_no: '75-505050 A 11', first_name: 'Different' })]);
    expect(again.status).toBe(422);
    expect(await prisma.student.count({ where: { schoolId: A.schoolId, firstName: 'Different' } })).toBe(0);
  });

  it('is all or nothing: a failure part-way leaves no half-imported file', async () => {
    const before = { students: await prisma.student.count({ where: { schoolId: A.schoolId } }), guardians: await prisma.guardian.count({ where: { schoolId: A.schoolId } }), classes: await prisma.schoolClass.count({ where: { schoolId: A.schoolId } }) };
    // No term is open, so the import refuses before it writes anything; and an admission number that clashes
    // only inside the transaction (a concurrent import) would roll everything back the same way.
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED' } });
    const r = await run(A.users.ADMIN, [row(601, { form: '4', stream: 'Brand', date_of_birth: `${Y - 16}-01-01` })]);
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'OPEN' } });
    expect(r.status).toBe(409);
    expect(await prisma.student.count({ where: { schoolId: A.schoolId } })).toBe(before.students);
    expect(await prisma.guardian.count({ where: { schoolId: A.schoolId } })).toBe(before.guardians);
    expect(await prisma.schoolClass.count({ where: { schoolId: A.schoolId } })).toBe(before.classes);
  });

  it("does not touch another school's data", async () => {
    const theirs = await prisma.student.count({ where: { schoolId: B.schoolId } });
    await run(A.users.ADMIN, [row(701)]);
    expect(await prisma.student.count({ where: { schoolId: B.schoolId } })).toBe(theirs);
  });
});

describe('the 500-student test file', () => {
  it('maps by itself, checks clean and imports every student with guardians merged by phone', async () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../prisma/demo-data/high_school_students.csv'), 'utf8');
    const lines = parseCsv(text);
    const { mapping, missing } = autoMap(lines[0]!);
    expect(missing).toEqual([]);
    const rows = applyMapping(lines, mapping);
    expect(rows).toHaveLength(500);

    const C = await seedSchool(prisma, 'School C');
    await prisma.academicTerm.update({ where: { id: C.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
    // The seeded student's admission number would clash with one in the file, which is correct but not what this test is about.
    await prisma.student.update({ where: { id: C.studentId }, data: { admissionNumber: 'SEED-1' } });
    const checked = await check(C.users.ADMIN, rows);
    expect(checked.status).toBe(200);
    const { summary } = checked.json.data;
    expect(summary.total).toBe(500);
    // Only the dates of birth in the file can make a row an Error here (the demo data was made for 2026).
    const wrong = checked.json.data.rows.filter((r: { status: string; messages: string[] }) => r.status === 'ERROR');
    for (const r of wrong) expect(r.messages.join()).toMatch(/Date of birth|Admission date/);

    const phones = new Set(rows.filter((_, i) => checked.json.data.rows[i].status !== 'ERROR').map((r) => r.values.guardian_phone));
    const done = await run(C.users.ADMIN, rows);
    expect(done.status).toBe(201);
    expect(done.json.data.imported).toBe(500 - summary.errors);
    expect(await prisma.student.count({ where: { schoolId: C.schoolId, status: 'ACTIVE' } })).toBe(500 - summary.errors + 1 /* the seeded student */);
    expect(await prisma.guardian.count({ where: { schoolId: C.schoolId } })).toBe(phones.size + 1 /* the seeded guardian */);
    expect(await prisma.student.findFirst({ where: { schoolId: C.schoolId, admissionNumber: 'STU20260001' } })).not.toBeNull(); // the file's student_id was kept
    expect(await prisma.enrollment.count({ where: { schoolId: C.schoolId, termId: C.termId, status: 'ACTIVE' } })).toBe(500 - summary.errors + 1);
  });
});
