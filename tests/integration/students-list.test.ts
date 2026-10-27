// @vitest-environment node
// The Students list and exports: search, filters, counts, who may see which column, and the audit entry of every export.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let n = 0;

interface NewStudent {
  firstName: string; surname: string; gender?: 'M' | 'F'; classId?: string; boarding?: 'DAY' | 'BOARDER'; houseId?: string;
  isBeam?: boolean; specialNeeds?: boolean; admissionDate?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'TRANSFERRED';
  birthCert?: string; phone?: string; dob?: string; sponsor?: string; severeAllergy?: boolean; incidents?: number;
}

async function addStudent(S: SeededSchool, o: NewStudent) {
  n++;
  const klass = o.classId ?? S.classId;
  const s = await prisma.student.create({
    data: {
      schoolId: S.schoolId, admissionNumber: `ADM${S.schoolId.slice(-4)}${n}`, firstName: o.firstName, surname: o.surname,
      fullName: `${o.firstName} ${o.surname}`, gender: o.gender ?? 'M', dateOfBirth: new Date(o.dob ?? '2013-06-01'),
      admissionDate: new Date(o.admissionDate ?? '2026-01-10'), currentClassId: klass, boarding: o.boarding ?? 'DAY', houseId: o.houseId,
      isBeam: o.isBeam ?? false, specialNeeds: o.specialNeeds ?? false, status: o.status ?? 'ACTIVE', birthCertificateNumber: o.birthCert, sponsorName: o.sponsor,
    },
  });
  await prisma.enrollment.create({ data: { schoolId: S.schoolId, studentId: s.id, classId: klass, termId: S.termId, startDate: new Date('2026-01-10'), status: o.status === 'TRANSFERRED' ? 'TRANSFERRED_OUT' : 'ACTIVE' } });
  if (o.phone) {
    const g = await prisma.guardian.upsert({
      where: { schoolId_phone: { schoolId: S.schoolId, phone: o.phone } }, update: {},
      create: { schoolId: S.schoolId, fullName: `Guardian of ${o.firstName}`, phone: o.phone, nationalId: '63-111111 X 11' },
    });
    await prisma.studentGuardian.create({ data: { studentId: s.id, guardianId: g.id, relationship: 'MOTHER', isPrimary: true } });
  }
  if (o.severeAllergy) {
    await prisma.medicalProfile.create({ data: { schoolId: S.schoolId, studentId: s.id, allergies: [{ name: 'penicillin', severity: 'SEVERE' }], hasSevereAllergy: true } });
  }
  if (o.incidents) {
    const inc = await prisma.disciplineIncident.create({ data: { schoolId: S.schoolId, occurredAt: new Date(), location: 'CLASSROOM', category: 'LATE_COMING', severity: 'MINOR', description: 'Late', recordedById: S.users.TEACHER.id } });
    await prisma.incidentStudent.create({ data: { schoolId: S.schoolId, incidentId: inc.id, studentId: s.id } });
  }
  return s;
}

let form2East: string;
let house: string;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  const level2 = await prisma.level.create({ data: { schoolId: A.schoolId, name: 'Form 2', order: 2, category: 'O_LEVEL' } });
  form2East = (await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 2 East', levelId: level2.id, stream: 'East' } })).id;
  house = (await prisma.house.create({ data: { schoolId: A.schoolId, name: 'Zambezi', colour: '#0A7' } })).id;

  await addStudent(A, { firstName: 'Rufaro', surname: 'Chari', gender: 'F', boarding: 'BOARDER', houseId: house, isBeam: true, phone: '+263772111222', birthCert: '63123456A42', severeAllergy: true, incidents: 2 });
  await addStudent(A, { firstName: 'Tatenda', surname: 'Dube', gender: 'M', classId: form2East, specialNeeds: true, phone: '+263773999888', admissionDate: '2025-01-15' });
  await addStudent(A, { firstName: 'Nyasha', surname: 'Moyo', gender: 'F', classId: form2East, boarding: 'BOARDER', status: 'SUSPENDED', sponsor: 'Old Mutual' });
  await addStudent(A, { firstName: 'Gone', surname: 'Away', status: 'TRANSFERRED' });
  await addStudent(B, { firstName: 'Rufaro', surname: 'Outsider', phone: '+263772111222' });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const list = (query = '', as = A.operator!) => call('students', 'GET', { as, query });
const names = (r: { json: { data: { rows: { fullName: string }[] } } }) => r.json.data.rows.map((x) => x.fullName).sort();

describe('who may open the list', () => {
  it('refuses a visitor who is not signed in', async () => {
    expect((await list('', null as never)).status).toBe(401);
  });

  it('refuses a user whose roles do not include students.profiles.view', async () => {
    expect((await list('', await userWithRoles(prisma, A, []))).status).toBe(403);
  });

  it('lets the owner and administrator see every student of their own school, and no other school', async () => {
    for (const u of [A.operator!, A.users.DIRECTOR]) {
      const r = await list('?status=', u);
      expect(r.status).toBe(200);
      expect(names(r as never)).toEqual(['Nyasha Moyo', 'Rufaro Chari', 'Tatenda Dube', 'Tendai Moyo1'].sort());
    }
    expect(JSON.stringify((await list('?q=outsider')).json)).not.toContain('Outsider');
  });

  it('shows a role that was given the permission only the students it teaches', async () => {
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.view');
    const r = await list('', A.users.TEACHER); // class teacher of Form 1 North only
    expect(r.status).toBe(200);
    expect(names(r as never)).toEqual(['Rufaro Chari', 'Tendai Moyo1']);
    expect((await list('?form=2', A.users.TEACHER)).json.data.rows).toHaveLength(0);
    expect((await list('?q=Dube', A.users.TEACHER)).json.data.rows).toHaveLength(0);
    // a subject allocation in the open term also counts
    await prisma.subjectAssignment.create({ data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId: A.subjectId, classId: form2East, termId: A.termId, marksStatus: 'IN_PROGRESS' } });
    expect(names((await list('', A.users.TEACHER)) as never)).toEqual(['Nyasha Moyo', 'Rufaro Chari', 'Tatenda Dube', 'Tendai Moyo1']);
  });
});

describe('search', () => {
  it('starts after 2 characters', async () => {
    const one = await list('?q=r');
    expect(one.json.data.searchTooShort).toBe(true);
    expect(one.json.data.rows.length).toBe(4); // too short to narrow anything
    expect(names((await list('?q=ru')) as never)).toEqual(['Rufaro Chari']);
  });

  it('finds by name in any order and ignores case', async () => {
    expect(names((await list('?q=tendai moyo')) as never)).toEqual(['Tendai Moyo1']);
    expect(names((await list('?q=MOYO tendai')) as never)).toEqual(['Tendai Moyo1']);
    expect(names((await list('?q=dube')) as never)).toEqual(['Tatenda Dube']);
  });

  it('finds by admission number', async () => {
    const row = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId, surname: 'Dube' } });
    expect(names((await list(`?q=${row.admissionNumber}`)) as never)).toEqual(['Tatenda Dube']);
  });

  it('finds by birth certificate number however it is typed', async () => {
    for (const q of ['63-123456 A 42', '63123456a42', '63 123456 A42']) {
      expect(names((await list(`?q=${encodeURIComponent(q)}`)) as never), q).toEqual(['Rufaro Chari']);
    }
  });

  it('finds by guardian phone however it is typed', async () => {
    for (const q of ['0772111222', '+263772111222', '772111222', '0772 111 222']) {
      expect(names((await list(`?q=${encodeURIComponent(q)}`)) as never), q).toEqual(['Rufaro Chari']);
    }
  });
});

describe('filters and counts', () => {
  const only = async (query: string) => names((await list(query)) as never);

  it('filters by form, class, stream, gender, boarding, house, BEAM, sponsored, special needs and admission year', async () => {
    expect(await only('?form=2')).toEqual(['Nyasha Moyo', 'Tatenda Dube']);
    expect(await only(`?classId=${form2East}`)).toEqual(['Nyasha Moyo', 'Tatenda Dube']);
    expect(await only('?stream=east')).toEqual(['Nyasha Moyo', 'Tatenda Dube']);
    expect(await only('?gender=F')).toEqual(['Nyasha Moyo', 'Rufaro Chari']);
    expect(await only('?boarding=BOARDER')).toEqual(['Nyasha Moyo', 'Rufaro Chari']);
    expect(await only('?boarding=DAY')).toEqual(['Tatenda Dube', 'Tendai Moyo1']);
    expect(await only(`?houseId=${house}`)).toEqual(['Rufaro Chari']);
    expect(await only('?beam=1')).toEqual(['Rufaro Chari']);
    expect(await only('?sponsored=1')).toEqual(['Nyasha Moyo']);
    expect(await only('?specialNeeds=1')).toEqual(['Tatenda Dube']);
    expect(await only('?admissionYear=2025')).toEqual(['Tatenda Dube']);
  });

  it('combines filters', async () => {
    expect(await only('?form=2&gender=F')).toEqual(['Nyasha Moyo']);
    expect(await only('?form=2&gender=F&boarding=DAY')).toEqual([]);
  });

  it('hides students who have left unless their status is asked for', async () => {
    expect(await only('')).not.toContain('Gone Away');
    expect(await only('?status=TRANSFERRED')).toEqual(['Gone Away']);
  });

  it('ignores a value it does not understand instead of failing', async () => {
    const r = await list('?gender=X&page=zero&boarding=DAY');
    expect(r.status).toBe(200);
    expect(names(r as never)).toEqual(['Tatenda Dube', 'Tendai Moyo1']);
  });

  it('counts the students at the school in the selected term', async () => {
    const { counts } = (await list('')).json.data;
    expect(counts).toEqual({ active: 3, suspended: 1, boarders: 2, day: 2, new: 3 });
  });

  it('makes each count a filter that returns exactly that many rows', async () => {
    expect(await only('?count=active')).toHaveLength(3);
    expect(await only('?count=suspended')).toEqual(['Nyasha Moyo']);
    expect(await only('?count=boarders')).toEqual(['Nyasha Moyo', 'Rufaro Chari']);
    expect(await only('?count=day')).toHaveLength(2);
    expect(await only('?count=new')).toEqual(['Nyasha Moyo', 'Rufaro Chari', 'Tendai Moyo1']);
  });

  it('pages and sorts', async () => {
    const r = await list('?pageSize=25&sort=name');
    expect(r.json.data.rows.map((x: { surname: string }) => x.surname)).toEqual(['Chari', 'Dube', 'Moyo', 'Moyo1']);
    const desc = await list('?sort=name&dir=desc');
    expect(desc.json.data.rows[0].surname).toBe('Moyo1');
    expect(r.json.data.total).toBe(4);
  });

  it('gives each row the age, the class and the primary guardian', async () => {
    const row = (await list('?q=rufaro')).json.data.rows[0];
    expect(row).toMatchObject({ className: 'Form 1 North', boarding: 'BOARDER', houseName: 'Zambezi', guardianPhone: '+263772111222', status: 'ACTIVE' });
    expect(row.age).toBeGreaterThanOrEqual(12);
  });
});

describe('guardian columns', () => {
  it('are empty for a user who may not see guardians, and filled for one who may', async () => {
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.profiles.view', 'CLASS');
    const bursar = await call('students', 'GET', { as: A.users.BURSAR, query: '' });
    // the bursar teaches nothing, so sees nobody; use a class they lead to check the columns
    expect(bursar.json.data.rows).toHaveLength(0);
    await prisma.schoolClass.update({ where: { id: form2East }, data: { classTeacherId: A.users.BURSAR.id } });
    const without = (await call('students', 'GET', { as: A.users.BURSAR, query: '?q=tatenda' })).json.data.rows[0];
    expect(without.guardianName).toBeNull();
    expect(without.guardianPhone).toBeNull();
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.guardians.view');
    const withG = (await call('students', 'GET', { as: A.users.BURSAR, query: '?q=tatenda' })).json.data.rows[0];
    expect(withG.guardianPhone).toBe('+263773999888');
  });
});

describe('exports', () => {
  const exportCsv = (as: typeof A.operator!, body: unknown = {}) => call('students/export', 'POST', { as, body });
  const header = (r: { text: string }) => r.text.replace(/^﻿/, '').split('\r\n')[0]!.split(',');

  it('needs students.profiles.export', async () => {
    expect((await exportCsv(A.users.BURSAR)).status).toBe(403);
    expect((await exportCsv(null as never)).status).toBe(401);
  });

  it('gives an administrator every column, and writes an audit entry with the columns taken', async () => {
    const r = await exportCsv(A.operator!);
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toContain('text/csv');
    expect(header(r)).toEqual(expect.arrayContaining(['Medical alert', 'Discipline incidents', 'Birth certificate number', 'Guardian national ID', 'Primary guardian']));
    expect(r.text).toContain('Severe allergy: penicillin');
    expect(r.text).toContain('63-123456 A 42');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'EXPORT_STUDENTS' }, orderBy: { createdAt: 'desc' } });
    expect(entry.actorId).toBe(A.operator!.id);
    expect(entry.after).toMatchObject({ count: 4 });
    expect((entry.after as { columns: string[] }).columns).toContain('medicalAlert');
  });

  it('leaves out medical, discipline and ID-number columns for a user who may not see them, and says so in the audit entry', async () => {
    await grantPermission(prisma, A.schoolId, 'BURSAR', 'students.profiles.export');
    const r = await exportCsv(A.users.BURSAR, { filters: {} });
    expect(r.status).toBe(200);
    for (const hidden of ['Medical alert', 'Special needs', 'Discipline incidents', 'Birth certificate number', 'Guardian national ID']) {
      expect(header(r), hidden).not.toContain(hidden);
    }
    expect(r.text).not.toContain('penicillin');
    expect(r.text).not.toContain('63-111111');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'EXPORT_STUDENTS', actorId: A.users.BURSAR.id } });
    expect((entry.after as { columns: string[] }).columns).not.toContain('medicalAlert');
  });

  it('cannot be talked into a hidden column by asking for it', async () => {
    const r = await exportCsv(A.users.BURSAR, { columns: ['admissionNumber', 'medicalAlert', 'guardianNationalId'] });
    expect(header(r)).toEqual(['Admission number']);
  });

  it('exports only the ticked rows, and never rows of another school or ones the user may not reach', async () => {
    const mine = await prisma.student.findFirstOrThrow({ where: { schoolId: A.schoolId, surname: 'Dube' } });
    const theirs = await prisma.student.findFirstOrThrow({ where: { schoolId: B.schoolId } });
    const r = await exportCsv(A.operator!, { ids: [mine.id, theirs.id], columns: ['surname'] });
    expect(r.text.replace(/^﻿/, '').trim().split('\r\n')).toEqual(['Surname', 'Dube']);
  });

  it('refuses an export of nothing', async () => {
    expect((await exportCsv(A.operator!, { filters: { q: 'zzzzzz' } })).status).toBe(404);
  });

  it('keeps spreadsheet formulas from running', async () => {
    const s = await addStudent(A, { firstName: '=SUM(A1)', surname: 'Formula' });
    const r = await exportCsv(A.operator!, { ids: [s.id], columns: ['firstName'] });
    expect(r.text).toContain("'=SUM(A1)");
  });
});
