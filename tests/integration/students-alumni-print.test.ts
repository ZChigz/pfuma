// @vitest-environment node
// Alumni (list, update, export), printed class lists and profiles, and the daily schedule that ends suspensions.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, userWithRoles, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { actorOf } from '../helpers/academics';
import { addClass, addStudent, dayOffset } from '../helpers/students';
import { PERMISSION_KEYS } from '@/lib/access-core';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;
let classLists: typeof import('@/lib/students/class-list').classLists;
let profileForPrint: typeof import('@/lib/students/class-list').profileForPrint;
let runScheduledNotifications: typeof import('@/lib/system/scheduled').runScheduledNotifications;
const Y = Number(dayOffset(0).slice(0, 4));

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  ({ classLists, profileForPrint } = await import('@/lib/students/class-list'));
  ({ runScheduledNotifications } = await import('@/lib/system/scheduled'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  for (const S of [A, B]) await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date(`${dayOffset(-30)}T00:00:00Z`), endDate: new Date(`${dayOffset(60)}T00:00:00Z`) } });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

// ─── Alumni ──────────────────────────────────────────────────────────────────

describe('alumni', () => {
  const alumniIds: Record<string, string> = {};

  it('are made automatically for students who complete a level, and can be added by hand for others', async () => {
    const grad = await addStudent(prisma, A, { firstName: 'Graduate', surname: 'Alpha' });
    const start = await call('students/leaving', 'POST', { as: A.operator!, body: { studentId: grad.id, reason: 'COMPLETED_A_LEVEL', lastDay: dayOffset(0) } });
    await call('students/leaving/[id]', 'POST', { as: A.operator!, params: { id: start.json.data.exit.id }, body: { action: 'approve', overrideReason: 'Clearance done on paper' } });
    await call('students/leaving/[id]', 'POST', { as: A.operator!, params: { id: start.json.data.exit.id }, body: { action: 'complete' } });
    alumniIds.grad = (await prisma.alumnus.findUniqueOrThrow({ where: { studentId: grad.id } })).id;

    const early = await addStudent(prisma, A, { firstName: 'Early', surname: 'Beta', status: 'WITHDRAWN' });
    expect((await call('students/alumni', 'POST', { as: A.users.TEACHER, body: { studentId: early.id, yearLeft: Y - 3 } })).status).toBe(403);
    expect((await call('students/alumni', 'POST', { as: A.operator!, body: { studentId: early.id, yearLeft: Y - 3, lastClass: 'Form 2 East', destination: 'Apprenticeship' } })).status).toBe(201);
    alumniIds.early = (await prisma.alumnus.findUniqueOrThrow({ where: { studentId: early.id } })).id;
    expect((await call('students/alumni', 'POST', { as: A.operator!, body: { studentId: early.id, yearLeft: Y - 3 } })).status).toBe(409); // already there
    expect((await call('students/alumni', 'POST', { as: A.operator!, body: { studentId: A.studentId, yearLeft: Y } })).status).toBe(409); // still at the school
    const dead = await addStudent(prisma, A, { status: 'DECEASED' });
    expect((await call('students/alumni', 'POST', { as: A.operator!, body: { studentId: dead.id, yearLeft: Y } })).status).toBe(409);
    expect((await call('students/alumni', 'POST', { as: A.operator!, body: { studentId: (await addStudent(prisma, B, { status: 'WITHDRAWN' })).id, yearLeft: Y } })).status).toBe(404);
  });

  it('are listed with search and a year filter, to those who may see alumni', async () => {
    expect((await call('students/alumni', 'GET', { as: A.users.BURSAR })).status).toBe(403);
    const all = await call('students/alumni', 'GET', { as: A.operator! });
    expect(all.status).toBe(200);
    expect(all.json.data.total).toBe(2);
    expect(all.json.data.years).toEqual([Y, Y - 3]);
    expect(all.json.data.rows.map((r: { fullName: string }) => r.fullName.split(' ')[0])).toEqual(['Graduate', 'Early']); // newest year first
    expect((await call('students/alumni', 'GET', { as: A.operator!, query: `?year=${Y - 3}` })).json.data.rows).toHaveLength(1);
    expect((await call('students/alumni', 'GET', { as: A.operator!, query: '?q=beta' })).json.data.rows[0].fullName).toContain('Beta');
    expect((await call('students/alumni', 'GET', { as: A.operator!, query: '?q=apprentice' })).json.data.rows).toHaveLength(1); // by what they went on to
    expect((await call('students/alumni', 'GET', { as: B.operator! })).json.data.total).toBe(0);
    expect(all.json.data.rows[0]).toMatchObject({ yearLeft: Y, lastClass: 'Form 1 North' });
  });

  it('can have their phone, email and what they went on to updated later', async () => {
    const patch = (id: string, body: Record<string, unknown>, as = A.operator!) => call('students/alumni/[id]', 'PATCH', { as, params: { id }, body });
    expect((await patch(alumniIds.grad!, { phone: '0772 000 111', email: 'Alpha@Mail.test', destination: 'University of Zimbabwe, BSc Nursing' }, A.users.TEACHER)).status).toBe(403);
    expect((await patch(alumniIds.grad!, { phone: '12', email: 'a@b.test' })).status).toBe(422);
    expect((await patch(alumniIds.grad!, { phone: '0772 000 111', email: 'nope' })).status).toBe(422);
    expect((await patch(alumniIds.grad!, { phone: '0772 000 111', email: 'Alpha@Mail.test', destination: 'University of Zimbabwe, BSc Nursing' })).status).toBe(200);
    expect(await prisma.alumnus.findUniqueOrThrow({ where: { id: alumniIds.grad! } })).toMatchObject({ phone: '+263772000111', email: 'alpha@mail.test', destination: 'University of Zimbabwe, BSc Nursing' });
    expect((await patch(alumniIds.grad!, {}, B.operator!)).status).toBe(404);
    // their phone and email never appear in the audit log
    const rows = JSON.stringify(await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: 'Alumnus' } }));
    expect(rows).not.toContain('772000111');
    expect(rows).not.toContain('alpha@mail.test');
    expect(rows).toContain('[hidden');
  });

  it('shows the latest published result when Exams is on', async () => {
    await prisma.termResult.create({ data: { schoolId: A.schoolId, studentId: (await prisma.alumnus.findUniqueOrThrow({ where: { id: alumniIds.grad! } })).studentId, termId: A.termId, totalMarks: 400, percentage: 71.5, letterGrade: 'B', published: true } });
    const r = (await call('students/alumni', 'GET', { as: A.operator!, query: '?q=alpha' })).json.data.rows[0];
    expect(r.finalResult).toMatchObject({ term: 'Term 1 2026', percentage: 71.5, grade: 'B' });
    await prisma.schoolModule.upsert({ where: { schoolId_module: { schoolId: A.schoolId, module: 'exams' } }, update: { enabled: false }, create: { schoolId: A.schoolId, module: 'exams', enabled: false } });
    expect((await call('students/alumni', 'GET', { as: A.operator!, query: '?q=alpha' })).json.data.rows[0].finalResult).toBeNull();
    await prisma.schoolModule.update({ where: { schoolId_module: { schoolId: A.schoolId, module: 'exams' } }, data: { enabled: true } });
  });

  it('are exported for reunions only with students.alumni.export, and every export is logged', async () => {
    expect((await call('students/alumni/export', 'GET', { as: A.users.TEACHER })).status).toBe(403);
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.alumni.view');
    expect((await call('students/alumni/export', 'GET', { as: A.users.TEACHER })).status).toBe(403); // viewing is not exporting
    const r = await call('students/alumni/export', 'GET', { as: A.operator!, query: `?year=${Y}` });
    expect(r.status).toBe(200);
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Admission number,Year left,Last class,Phone,Email,Went on to');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('+263772000111');
    expect(lines[1]).toContain('alpha@mail.test');
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'EXPORT_ALUMNI' } });
    expect(entry).toMatchObject({ actorId: A.operator!.id });
    expect(entry.after).toMatchObject({ count: 1, filters: { year: Y } });
    expect((await call('students/alumni/export', 'GET', { as: A.operator!, query: '?q=zzzzzz' })).status).toBe(404);
  });
});

// ─── Printing ────────────────────────────────────────────────────────────────

describe('class lists', () => {
  let klass: string;

  it('number the names in alphabetical order by surname, with boys and girls together or apart', async () => {
    klass = (await addClass(prisma, A, 'Form 3 North', { order: 3 })).id;
    for (const [first, last, gender] of [['Tendai', 'Moyo', 'M'], ['Rufaro', 'Dube', 'F'], ['Tino', 'Chari', 'M'], ['Anesu', 'Dube', 'M'], ['Zodwa', 'Ndlovu', 'F']] as const) {
      await addStudent(prisma, A, { classId: klass, firstName: first, surname: last, gender });
    }
    const together = await classLists({ id: A.operator!.id, schoolId: A.schoolId, role: 'ADMIN', grants: [...PERMISSION_KEYS] }, [klass], { separate: false });
    expect(together.pages).toHaveLength(1);
    expect(together.pages[0]).toMatchObject({ className: 'Form 3 North', total: 5, boys: 3, girls: 2 });
    expect(together.pages[0]!.sections).toHaveLength(1);
    expect(together.pages[0]!.sections[0]!.students.map((s) => [s.n, s.fullName])).toEqual([[1, 'CHARI, Tino'], [2, 'DUBE, Anesu'], [3, 'DUBE, Rufaro'], [4, 'MOYO, Tendai'], [5, 'NDLOVU, Zodwa']]);

    const apart = await classLists({ id: A.operator!.id, schoolId: A.schoolId, role: 'ADMIN', grants: [...PERMISSION_KEYS] }, [klass], { separate: true });
    expect(apart.pages[0]!.sections.map((s) => [s.title, s.students.map((x) => `${x.n}.${x.fullName.split(',')[0]}`)])).toEqual([
      ['Boys', ['1.CHARI', '2.DUBE', '3.MOYO']], ['Girls', ['1.DUBE', '2.NDLOVU']],
    ]);
  });

  it('show the class teacher, and leave out students who have left or are not in the class this term', async () => {
    const teacher = A.users.TEACHER;
    await prisma.schoolClass.update({ where: { id: klass }, data: { classTeacherId: teacher.id } });
    await addStudent(prisma, A, { classId: klass, firstName: 'Left', surname: 'Away', status: 'TRANSFERRED' });
    const data = await classLists({ id: A.operator!.id, schoolId: A.schoolId, role: 'ADMIN', grants: [...PERMISSION_KEYS] }, [klass], { separate: false });
    expect(data.pages[0]!.classTeacher).toBe(teacher.fullName);
    expect(data.pages[0]!.total).toBe(5);
    expect(JSON.stringify(data)).not.toContain('AWAY');
    expect(data.school.name).toBe('School A');
  });

  it('are printed as one A4 page per class, only by those who may see students, and the printing is logged', async () => {
    const q = (extra = '') => call('students/class-list', 'GET', { as: A.operator!, query: `?classIds=${klass},${A.classId}${extra}` });
    const r = await q('&separate=1');
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toBe('application/pdf');
    expect(r.text.startsWith('%PDF')).toBe(true);
    expect((r.text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((await call('students/class-list', 'GET', { as: (await userWithRoles(prisma, A, [])), query: `?classIds=${klass}` })).status).toBe(403);
    expect((await call('students/class-list', 'GET', { as: A.operator!, query: '' })).status).toBe(422);
    expect((await call('students/class-list', 'GET', { as: A.operator!, query: `?classIds=${B.classId}` })).status).toBe(404);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { schoolId: A.schoolId, action: 'PRINT_STUDENT', entityType: 'SchoolClass' }, orderBy: { createdAt: 'desc' } });
    expect(entry.after).toMatchObject({ classes: [klass, A.classId], separate: true });
  });

  it('list only the students a teacher teaches', async () => {
    await grantPermission(prisma, A.schoolId, 'TEACHER', 'students.profiles.view');
    const other = (await addClass(prisma, A, 'Form 3 East', { order: 3 })).id;
    await addStudent(prisma, A, { classId: other, firstName: 'Hidden', surname: 'Pupil' });
    const asTeacher = await classLists(await actorOf(prisma, A.users.TEACHER.id), [klass, other], { separate: false });
    expect(asTeacher.pages.find((p) => p.className === 'Form 3 North')!.total).toBe(5);
    expect(asTeacher.pages.find((p) => p.className === 'Form 3 East')!.total).toBe(0);
  });
});

describe('printed profiles', () => {
  it('hold Overview, Guardians and Enrolment for those who may see all three', async () => {
    const s = await addStudent(prisma, A, { firstName: 'Profile', surname: 'Print' });
    const admin = { id: A.operator!.id, schoolId: A.schoolId, role: 'ADMIN' as const, grants: [...PERMISSION_KEYS] };
    const full = await profileForPrint(admin, s.id);
    expect(full.header.fullName).toBe('Profile Print');
    expect(full.guardians).toHaveLength(1);
    expect(full.enrolment!.history).toHaveLength(1);
    expect(full.school.name).toBe('School A');
    const narrow = await profileForPrint({ id: A.users.TEACHER.id, schoolId: A.schoolId, role: 'TEACHER', grants: ['students.profiles.view'] }, s.id);
    expect(narrow.guardians).toBeNull();
    expect(narrow.enrolment).toBeNull();
    expect(narrow.overview.birthCertificateNumber).toBeNull();
    expect(narrow.overview.primaryGuardian).toBeNull();
  });

  it('are PDFs, logged, and refused for other schools, other classes and users without access', async () => {
    const s = await addStudent(prisma, A, { firstName: 'Second', surname: 'Print' });
    const r = await call('students/[id]/print', 'GET', { as: A.operator!, params: { id: s.id } });
    expect(r.status).toBe(200);
    expect(r.response.headers.get('content-type')).toBe('application/pdf');
    expect(r.text.startsWith('%PDF')).toBe(true);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'PRINT_STUDENT', entityId: s.id } })).toBe(1);
    expect((await call('students/[id]/print', 'GET', { as: (await userWithRoles(prisma, A, [])), params: { id: s.id } })).status).toBe(403);
    expect((await call('students/[id]/print', 'GET', { as: B.operator!, params: { id: s.id } })).status).toBe(404);
  });
});

// ─── The daily schedule ──────────────────────────────────────────────────────

describe('the daily schedule', () => {
  it('ends a suspension the day after its end date and starts one on its first day, once', async () => {
    const ending = await addStudent(prisma, A);
    const starting = await addStudent(prisma, A);
    const incident = await prisma.disciplineIncident.create({ data: { schoolId: A.schoolId, occurredAt: new Date(), location: 'CLASSROOM', category: 'FIGHTING', severity: 'SERIOUS', description: 'Fight', recordedById: A.operator!.id } });
    const mk = (studentId: string, start: string, end: string) => prisma.disciplineAction.create({ data: { schoolId: A.schoolId, incidentId: incident.id, studentId, type: 'SUSPENSION', status: 'APPROVED', startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`), requestedById: A.operator!.id, approvedById: A.operator!.id } });
    await mk(ending.id, dayOffset(-4), dayOffset(-1));
    await prisma.student.update({ where: { id: ending.id }, data: { status: 'SUSPENDED' } });
    await mk(starting.id, dayOffset(0), dayOffset(3));

    const noon = new Date(`${dayOffset(0)}T10:00:00Z`);
    const first = await runScheduledNotifications(noon);
    expect(first.suspensionsEnded).toBeGreaterThanOrEqual(1);
    expect(first.suspensionsStarted).toBeGreaterThanOrEqual(1);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: ending.id } })).status).toBe('ACTIVE');
    expect((await prisma.student.findUniqueOrThrow({ where: { id: starting.id } })).status).toBe('SUSPENDED');
    const again = await runScheduledNotifications(noon);
    expect(again.suspensionsEnded).toBe(0);
    expect(again.suspensionsStarted).toBe(0);
    expect(await prisma.auditLog.count({ where: { schoolId: A.schoolId, action: 'END_SUSPENSION', entityId: ending.id } })).toBe(1);
  });

  it('is only run by the scheduler with the secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests';
    const { NextRequest } = await import('next/server');
    const mod = await import('../../app/api/cron/notifications/route');
    const run = (auth?: string) => (mod.GET as (r: Request) => Promise<Response>)(new NextRequest('http://localhost/api/cron/notifications', { headers: auth ? { authorization: auth } : {} }));
    expect((await run()).status).toBe(401);
    expect((await run('Bearer wrong')).status).toBe(401);
    const ok = await run('Bearer cron-secret-for-tests');
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ suspensionsStarted: expect.any(Number), suspensionsEnded: expect.any(Number) });
  });
});
