// @vitest-environment node
// The Classes page (class teacher, subjects and gaps, copy from last term) and teacher assignments (the hub): the rules in
// the brief, who sees what, mid-term changes, approval of the whole set, and the grid, workload and gaps pages.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { grantPermission, seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';
import { NOW, addTeacher, assign, buildWorld, sessionFor, students, type World } from '../helpers/academics';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: World;
let prisma: typeof import('@/lib/prisma').prisma;
let f1: string[];
let f2: string[];

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  f1 = await students(prisma, A, W.f1North, 5, 'One');
  f2 = await students(prisma, A, W.f2East, 3, 'Two');
}, 180_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

const admin = () => A.users.ADMIN;
const audit = (action: string) => prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: action as never } });
const mk = (o: object = {}) => ({ teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North, periodsPerWeek: 5, ...o });

describe('teacher assignments: the rules', () => {
  it('give a teacher a subject for a class, with periods, doubles and a second teacher', async () => {
    const r = await call('academics/assignments', 'POST', { as: admin(), body: mk({ doublesPerWeek: 1, coTeacherId: W.teachers.moyo }) });
    expect(r.status).toBe(201);
    const a = await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: r.json.data.id } });
    expect(a).toMatchObject({ teacherId: W.teachers.chikore, coTeacherId: W.teachers.moyo, subjectId: W.subjects.maths, classId: W.f1North, groupId: null, periodsPerWeek: 5, doublesPerWeek: 1, status: 'ACTIVE', endDate: null });
    expect(a.startDate.toISOString().slice(0, 10)).toBe('2026-10-14'); // the open term has started: from today
    // The marks pages (Examinations) still read SubjectAssignment: it follows.
    const legacy = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId: W.f1North, subjectId: W.subjects.maths, termId: A.termId } });
    expect(legacy.teacherId).toBe(W.teachers.chikore);
    expect((await audit('CREATE_TEACHER_ASSIGNMENT')).length).toBe(1);
    // The teacher was told.
    expect((await prisma.notification.findMany({ where: { userId: W.teachers.chikore, type: 'ASSIGNMENT' } })).length).toBe(1);
  });

  it('are one per term, subject and class', async () => {
    const r = await call('academics/assignments', 'POST', { as: admin(), body: mk({ teacherId: W.teachers.ncube }) });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Form 1 North already has Mr Tendai Chikore teaching Mathematics/);
    // The database says the same thing, whatever the code does.
    await expect(
      t.pg.exec(`INSERT INTO "TeacherAssignment" (id, "schoolId", "termId", "teacherId", "subjectId", "classId", "periodsPerWeek", "startDate", "updatedAt") VALUES ('dup', '${A.schoolId}', '${A.termId}', '${W.teachers.ncube}', '${W.subjects.maths}', '${W.f1North}', 3, '2026-10-14', now())`),
    ).rejects.toThrow(/TeacherAssignment_one_active_per_class/);
  });

  it('need an active user with the Teacher role', async () => {
    const bursar = await call('academics/assignments', 'POST', { as: admin(), body: mk({ teacherId: A.users.BURSAR.id, subjectId: W.subjects.english }) });
    expect(bursar.status).toBe(409);
    expect(bursar.json.message).toMatch(/does not have the Teacher role/);
    await prisma.user.update({ where: { id: W.teachers.dube }, data: { active: false } });
    const gone = await call('academics/assignments', 'POST', { as: admin(), body: mk({ teacherId: W.teachers.dube, subjectId: W.subjects.english }) });
    expect(gone.status).toBe(409);
    expect(gone.json.message).toMatch(/is not an active user/);
    await prisma.user.update({ where: { id: W.teachers.dube }, data: { active: true } });
    const other = await call('academics/assignments', 'POST', { as: admin(), body: mk({ teacherId: B.users.TEACHER.id, subjectId: W.subjects.english }) });
    expect(other.status).toBe(404);
    const co = await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.english, coTeacherId: A.users.BURSAR.id }) });
    expect(co.status).toBe(409);
    expect(co.json.message).toMatch(/Teacher role/);
  });

  it('need a subject the form offers', async () => {
    const r = await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.accounts }) });
    expect(r.status).toBe(422);
    expect(r.json.message).toMatch(/Accounts is not offered in Form 1/);
  });

  it('take a class or a group, periods that fit, and doubles that fit in them', async () => {
    expect((await call('academics/assignments', 'POST', { as: admin(), body: { teacherId: W.teachers.moyo, subjectId: W.subjects.english, periodsPerWeek: 4 } })).status).toBe(422);
    expect((await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.english, periodsPerWeek: 0 }) })).status).toBe(422);
    expect((await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.english, periodsPerWeek: 3, doublesPerWeek: 2 }) })).status).toBe(422);
    expect((await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.english, classId: 'nope' }) })).status).toBe(404);
    expect((await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.english, classId: B.classId }) })).status).toBe(404);
  });

  it('warn, without stopping, when a teacher would have more periods than the school maximum', async () => {
    await prisma.academicsSettings.upsert({ where: { schoolId: A.schoolId }, update: { maxPeriodsPerWeek: 8 }, create: { schoolId: A.schoolId, maxPeriodsPerWeek: 8 } });
    const r = await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.science, classId: W.f1North, periodsPerWeek: 5 }) });
    expect(r.status).toBe(201);
    expect(r.json.data.warnings[0]).toMatch(/Mr Tendai Chikore will have 10 periods a week; the school's maximum is 8/);
  });

  it('are closed to a teacher, who sees only their own', async () => {
    const t1 = A.users.TEACHER;
    expect((await call('academics/assignments', 'POST', { as: t1, body: mk({ subjectId: W.subjects.english }) })).status).toBe(403);
    await assign(prisma, A, { teacherId: t1.id, subjectId: W.subjects.english, classId: W.f1North, periods: 3 });
    const mine = await call('academics/assignments', 'GET', { as: t1 });
    expect(mine.status).toBe(200);
    expect(mine.json.data.assignments.map((a: { teacherId: string }) => a.teacherId)).toEqual([t1.id]);
    const all = await call('academics/assignments', 'GET', { as: admin() });
    expect(new Set(all.json.data.assignments.map((a: { teacherId: string }) => a.teacherId)).size).toBeGreaterThan(1);
    expect((await call('academics/assignments/[id]', 'PATCH', { as: t1, params: { id: all.json.data.assignments[0].id }, body: { periodsPerWeek: 2 } })).status).toBe(403);
  });

  it('can be changed in periods and second teacher, but not once ended', async () => {
    const a = await prisma.teacherAssignment.findFirstOrThrow({ where: { schoolId: A.schoolId, subjectId: W.subjects.science, classId: W.f1North, status: 'ACTIVE' } });
    const r = await call('academics/assignments/[id]', 'PATCH', { as: admin(), params: { id: a.id }, body: { periodsPerWeek: 3, coTeacherId: W.teachers.ncube } });
    expect(r.status).toBe(200);
    expect(await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ periodsPerWeek: 3, coTeacherId: W.teachers.ncube });
    expect((await call('academics/assignments/[id]', 'PATCH', { as: admin(), params: { id: a.id }, body: { periodsPerWeek: 3, doublesPerWeek: 2 } })).status).toBe(422);
    expect((await audit('UPDATE_TEACHER_ASSIGNMENT')).length).toBeGreaterThan(0);
  });
});

describe('changing the teacher in the middle of a term', () => {
  it('ends the old assignment the day before and starts a new one, so earlier records keep their teacher', async () => {
    const old = await prisma.teacherAssignment.findFirstOrThrow({ where: { schoolId: A.schoolId, subjectId: W.subjects.english, classId: W.f1North, status: 'ACTIVE' } });
    // A mark entered by the first teacher before the change.
    await prisma.mark.create({ data: { schoolId: A.schoolId, studentId: f1[0]!, subjectId: W.subjects.english, termId: A.termId, rawMark: 55, percentage: 55, enteredBy: old.teacherId } });
    const r = await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: old.id }, body: { teacherId: W.teachers.moyo, effectiveDate: '2026-10-19', reason: 'Mr left for leave' } });
    expect(r.status).toBe(200);
    const ended = await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: old.id } });
    expect(ended.status).toBe('ENDED');
    expect(ended.endDate!.toISOString().slice(0, 10)).toBe('2026-10-18');
    const next = await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: r.json.data.id } });
    expect(next).toMatchObject({ teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1North, status: 'ACTIVE', periodsPerWeek: old.periodsPerWeek });
    expect(next.startDate.toISOString().slice(0, 10)).toBe('2026-10-19');
    // Marks already entered keep the original teacher; the marks page now sees the new one.
    expect((await prisma.mark.findFirstOrThrow({ where: { studentId: f1[0]!, subjectId: W.subjects.english } })).enteredBy).toBe(old.teacherId);
    expect((await prisma.subjectAssignment.findFirstOrThrow({ where: { classId: W.f1North, subjectId: W.subjects.english, termId: A.termId } })).teacherId).toBe(W.teachers.moyo);
    const logged = (await audit('REPLACE_TEACHER'))[0]!;
    expect(logged.detail).toMatch(/→ Mrs Rudo Moyo from 2026-10-19\. Mr left for leave/);
    // Both teachers were told.
    expect(await prisma.notification.count({ where: { userId: W.teachers.moyo, type: 'ASSIGNMENT' } })).toBeGreaterThan(0);
  });

  it('refuses an ended assignment, the same teacher, a date before it started and a teacher without the role', async () => {
    const ended = await prisma.teacherAssignment.findFirstOrThrow({ where: { schoolId: A.schoolId, subjectId: W.subjects.english, classId: W.f1North, status: 'ENDED' } });
    expect((await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: ended.id }, body: { teacherId: W.teachers.ncube, effectiveDate: '2026-10-25' } })).status).toBe(409);
    const live = await prisma.teacherAssignment.findFirstOrThrow({ where: { schoolId: A.schoolId, subjectId: W.subjects.english, classId: W.f1North, status: 'ACTIVE' } });
    expect((await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: live.id }, body: { teacherId: live.teacherId, effectiveDate: '2026-10-25' } })).json.message).toMatch(/already teaches this/);
    expect((await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: live.id }, body: { teacherId: W.teachers.ncube, effectiveDate: '2026-10-19' } })).json.message).toMatch(/must start after 2026-10-19/);
    expect((await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: live.id }, body: { teacherId: A.users.BURSAR.id, effectiveDate: '2026-10-25' } })).status).toBe(409);
    expect((await call('academics/assignments/[id]/replace', 'POST', { as: admin(), params: { id: live.id }, body: { teacherId: W.teachers.ncube, effectiveDate: '2027-02-01' } })).status).toBe(422);
  });

  it('can end an assignment with no replacement, and cannot remove one that has history', async () => {
    const a = await assign(prisma, A, { teacherId: W.teachers.dube, subjectId: W.subjects.maths, classId: W.f2East, periods: 3 });
    const bad = await call('academics/assignments/[id]/end', 'POST', { as: admin(), params: { id: a.id }, body: { date: '2026-08-01' } });
    expect(bad.status).toBe(422);
    expect((await call('academics/assignments/[id]/end', 'POST', { as: admin(), params: { id: a.id }, body: { date: '2026-10-16', reason: 'left' } })).status).toBe(200);
    expect(await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'ENDED' });
    // One with a scheme of work cannot be deleted.
    const b = await assign(prisma, A, { teacherId: W.teachers.dube, subjectId: W.subjects.english, classId: W.f2East, periods: 3 });
    await prisma.schemeOfWork.create({ data: { schoolId: A.schoolId, termId: A.termId, assignmentId: b.id } });
    const r = await call('academics/assignments/[id]', 'DELETE', { as: admin(), params: { id: b.id } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/End it instead/);
    // One made by mistake can.
    const c = await assign(prisma, A, { teacherId: W.teachers.dube, subjectId: W.subjects.science, classId: W.f2East, periods: 3 });
    expect((await call('academics/assignments/[id]', 'DELETE', { as: admin(), params: { id: c.id } })).status).toBe(200);
    expect(await prisma.teacherAssignment.count({ where: { id: c.id } })).toBe(0);
  });
});

describe('approval of the whole set', () => {
  it('goes to the Head as one; the approver is recorded on every assignment', async () => {
    const before = await call('academics/assignments/set', 'GET', { as: admin() });
    expect(before.json.data.status).toBe('DRAFT');
    expect((await call('academics/assignments/set', 'POST', { as: A.users.TEACHER, body: {} })).status).toBe(403);
    const sent = await call('academics/assignments/set', 'POST', { as: admin(), body: {} });
    expect(sent.status).toBe(200);
    expect((await call('academics/assignments/set', 'POST', { as: admin(), body: {} })).json.message).toMatch(/already waiting/);
    expect((await audit('SUBMIT_ASSIGNMENTS')).length).toBe(1);
    // A person who may not approve cannot; one who may, can, and cannot return without a note.
    expect((await call('academics/assignments/set/decide', 'POST', { as: A.users.TEACHER, body: { decision: 'APPROVE' } })).status).toBe(403);
    await grantPermission(prisma, A.schoolId, 'HEAD', 'academics.assignments.approve');
    expect((await call('academics/assignments/set/decide', 'POST', { as: A.users.HEAD, body: { decision: 'RETURN' } })).status).toBe(422);
    const back = await call('academics/assignments/set/decide', 'POST', { as: A.users.HEAD, body: { decision: 'RETURN', note: 'Add Geography' } });
    expect(back.json.data.status).toBe('RETURNED');
    expect((await call('academics/assignments/set', 'GET', { as: admin() })).json.data).toMatchObject({ status: 'RETURNED', note: 'Add Geography' });
    await call('academics/assignments/set', 'POST', { as: admin(), body: {} });
    const ok = await call('academics/assignments/set/decide', 'POST', { as: A.users.HEAD, body: { decision: 'APPROVE' } });
    expect(ok.json.data.status).toBe('APPROVED');
    const live = await prisma.teacherAssignment.findMany({ where: { schoolId: A.schoolId, termId: A.termId, status: 'ACTIVE' } });
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((a) => a.approvedById === A.users.HEAD.id && a.approvedAt)).toBe(true);
    expect((await audit('APPROVE_ASSIGNMENTS')).length).toBe(1);
  });

  it('can still be fixed one by one by the administrator afterwards, and each fix is logged', async () => {
    const r = await call('academics/assignments', 'POST', { as: admin(), body: mk({ subjectId: W.subjects.maths, classId: W.f2East, teacherId: W.teachers.moyo, periodsPerWeek: 4 }) });
    expect(r.status).toBe(201);
    const logged = (await audit('CREATE_TEACHER_ASSIGNMENT')).find((a) => a.entityId === r.json.data.id)!;
    expect(logged.detail).toMatch(/changed after the term's assignments were approved/);
    // The new one is visibly not part of what the Head approved.
    expect((await prisma.teacherAssignment.findUniqueOrThrow({ where: { id: r.json.data.id } })).approvedById).toBeNull();
  });
});

describe('the class teacher', () => {
  it('gets the CLASS_TEACHER role for that class only, and the old class column follows the open term', async () => {
    const r = await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f2East }, body: { userId: W.teachers.moyo } });
    expect(r.status).toBe(200);
    expect(r.json.data.warnings).toEqual([]);
    expect(await prisma.classTeacher.findFirstOrThrow({ where: { classId: W.f2East, termId: A.termId } })).toMatchObject({ userId: W.teachers.moyo });
    const role = await prisma.userRole.findFirstOrThrow({ where: { userId: W.teachers.moyo, scopeType: 'CLASS' }, include: { role: true } });
    expect([role.role.key, role.scopeId]).toEqual(['CLASS_TEACHER', W.f2East]);
    expect((await prisma.schoolClass.findUniqueOrThrow({ where: { id: W.f2East } })).classTeacherId).toBe(W.teachers.moyo);
    expect((await audit('SET_CLASS_TEACHER')).length).toBe(1);
    expect(await prisma.notification.count({ where: { userId: W.teachers.moyo, type: 'CLASS_TEACHER' } })).toBe(1);
  });

  it('is one per class per term: a new one replaces the old and takes the role away', async () => {
    await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f2East }, body: { userId: W.teachers.ncube } });
    expect(await prisma.classTeacher.count({ where: { classId: W.f2East, termId: A.termId } })).toBe(1);
    expect(await prisma.userRole.count({ where: { userId: W.teachers.moyo, scopeType: 'CLASS' } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: W.teachers.ncube, scopeType: 'CLASS', scopeId: W.f2East } })).toBe(1);
  });

  it('warns, but allows it, when the teacher already has another class', async () => {
    const r = await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f3North }, body: { userId: W.teachers.ncube } });
    expect(r.status).toBe(200);
    expect(r.json.data.warnings[0]).toMatch(/already the class teacher of Form 2 East/);
    expect(await prisma.classTeacher.count({ where: { userId: W.teachers.ncube, termId: A.termId } })).toBe(2);
  });

  it('can be cleared, and is checked: active, in this school, and not for a closed term', async () => {
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f3North }, body: { userId: null } })).status).toBe(200);
    expect(await prisma.classTeacher.count({ where: { classId: W.f3North } })).toBe(0);
    await prisma.user.update({ where: { id: W.teachers.dube }, data: { active: false } });
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f3North }, body: { userId: W.teachers.dube } })).status).toBe(409);
    await prisma.user.update({ where: { id: W.teachers.dube }, data: { active: true } });
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f3North }, body: { userId: B.users.TEACHER.id } })).status).toBe(404);
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: B.classId }, body: { userId: W.teachers.moyo } })).status).toBe(404);
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: A.users.TEACHER, params: { id: W.f3North }, body: { userId: W.teachers.moyo } })).status).toBe(403);
  });

  it('keeps the role through an edit of the person\'s roles in Users', async () => {
    const before = await prisma.userRole.count({ where: { userId: W.teachers.ncube, scopeType: 'CLASS' } });
    expect(before).toBe(1);
    const r = await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: W.teachers.ncube }, body: { roles: ['TEACHER', 'CLASS_TEACHER'] } });
    expect(r.status).toBe(200);
    const rows = await prisma.userRole.findMany({ where: { userId: W.teachers.ncube }, include: { role: true } });
    expect(rows.filter((x) => x.role.key === 'CLASS_TEACHER').map((x) => x.scopeType)).toEqual(['CLASS']); // not turned into a school-wide role
    await call('system/users/[id]', 'PATCH', { as: admin(), params: { id: W.teachers.ncube }, body: { roles: ['TEACHER'] } });
    expect(await prisma.userRole.count({ where: { userId: W.teachers.ncube, scopeType: 'CLASS' } })).toBe(0);
    await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f2East }, body: { userId: W.teachers.ncube } });
  });
});

describe('the classes page', () => {
  it('lists the classes of the term with their teacher, boys and girls, capacity, subjects, timetable and register', async () => {
    const r = await call('academics/classes', 'GET', { as: admin() });
    expect(r.status).toBe(200);
    const rows = r.json.data.classes as { id: string; name: string; classTeacher: string | null; students: number; boys: number; girls: number; capacity: number; subjects: number; timetable: string; today: string }[];
    const f1row = rows.find((c) => c.id === W.f1North)!;
    expect(f1row).toMatchObject({ name: 'Form 1 North', students: 6, boys: 4, girls: 2, capacity: 45, timetable: 'NONE', today: 'NOT_MARKED' }); // 5 + the seeded student
    expect(f1row.subjects).toBeGreaterThan(0);
    expect(rows.find((c) => c.id === W.f2East)).toMatchObject({ classTeacher: 'Ms Thando Ncube', students: 3 });
    // Once the morning register is marked it says so.
    await prisma.attendanceRegister.create({ data: { schoolId: A.schoolId, termId: A.termId, classId: W.f1North, date: new Date('2026-10-14'), session: 'AM', markedById: admin().id } });
    const again = await call('academics/classes', 'GET', { as: admin() });
    expect(again.json.data.classes.find((c: { id: string }) => c.id === W.f1North).today).toBe('MARKED');
    await prisma.attendanceRegister.deleteMany({ where: { classId: W.f1North } });
  });

  it('shows a teacher only the classes they teach or look after, and refuses the rest as not found', async () => {
    const mrChikore = await sessionFor(prisma, W.teachers.chikore);
    const mine = await call('academics/classes', 'GET', { as: mrChikore });
    expect(mine.json.data.classes.map((c: { name: string }) => c.name)).toEqual(['Form 1 North']);
    expect((await call('academics/classes/[id]', 'GET', { as: mrChikore, params: { id: W.f1North } })).status).toBe(200);
    expect((await call('academics/classes/[id]', 'GET', { as: mrChikore, params: { id: W.f2East } })).status).toBe(404);
    expect((await call('academics/classes/[id]/students', 'GET', { as: mrChikore, params: { id: W.f2East } })).status).toBe(404);
    // A class teacher sees the class they look after.
    const ncube = await sessionFor(prisma, W.teachers.ncube);
    expect((await call('academics/classes', 'GET', { as: ncube })).json.data.classes.map((c: { name: string }) => c.name)).toContain('Form 2 East');
  });

  it('has a Students tab from the Enrollment, by surname and numbered, and exports it', async () => {
    const r = await call('academics/classes/[id]/students', 'GET', { as: admin(), params: { id: W.f2East } });
    expect(r.status).toBe(200);
    expect(r.json.data.students.map((s: { n: number }) => s.n)).toEqual([1, 2, 3]);
    const surnames = r.json.data.students.map((s: { surname: string }) => s.surname);
    expect(surnames).toEqual([...surnames].sort());
    // A student who left the class is not on the list: the class always comes from the term's Enrollment.
    await prisma.enrollment.updateMany({ where: { studentId: f2[0]!, termId: A.termId }, data: { status: 'TRANSFERRED_OUT', endDate: new Date('2026-10-01') } });
    expect((await call('academics/classes/[id]/students', 'GET', { as: admin(), params: { id: W.f2East } })).json.data.students).toHaveLength(2);
    await prisma.enrollment.updateMany({ where: { studentId: f2[0]!, termId: A.termId }, data: { status: 'ACTIVE', endDate: null } });
    const csv = await call('academics/classes/[id]/students', 'GET', { as: admin(), params: { id: W.f2East }, query: '?format=csv' });
    expect(csv.text).toMatch(/^No,Admission number,Surname,First name,Gender,Boarding/);
    expect(csv.text.trim().split(/\r?\n/)).toHaveLength(4);
  });

  it('has a Subjects and teachers tab that highlights gaps', async () => {
    const r = await call('academics/classes/[id]/subjects', 'GET', { as: admin(), params: { id: W.f1North } });
    expect(r.status).toBe(200);
    const rows = r.json.data.rows as { subject: string; teacher: string | null; gap: boolean }[];
    expect(rows.find((x) => x.subject === 'Mathematics')).toMatchObject({ teacher: 'Mr Tendai Chikore', gap: false });
    const geo = rows.find((x) => x.subject === 'Geography')!;
    expect(geo).toMatchObject({ teacher: null, gap: true });
    expect(r.json.data.gaps).toContain('Geography has no teacher');
  });

  it('has an Attendance tab and a Timetable tab', async () => {
    expect((await call('academics/classes/[id]/attendance', 'GET', { as: admin(), params: { id: W.f1North } })).status).toBe(200);
    const tt = await call('academics/classes/[id]/timetable', 'GET', { as: admin(), params: { id: W.f1North } });
    expect(tt.status).toBe(200);
    expect(tt.json.data.timetable).toBeNull();
  });
});

describe('the grid, workload and gaps pages', () => {
  it('shows classes down the side, subjects across the top, initials in the cells and gaps to fill', async () => {
    const r = await call('academics/assignments', 'GET', { as: admin(), query: '?view=grid' });
    expect(r.status).toBe(200);
    const g = r.json.data;
    expect(g.classes.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Form 1 North', 'Form 2 East', 'Form 3 North']));
    const sub = (id: string) => g.subjects.find((s: { id: string }) => s.id === id);
    expect(sub(W.subjects.maths)).toBeTruthy();
    expect(g.cells[`${W.f1North}:${W.subjects.maths}`]).toMatchObject({ state: 'assigned', initials: 'TC' });
    expect(g.cells[`${W.f1North}:${W.subjects.geography}`]).toMatchObject({ state: 'gap' }); // taken (core in Form 1) and nobody teaches it
    expect(g.cells[`${W.f1North}:${W.subjects.accounts}`]).toMatchObject({ state: 'na' }); // not offered in Form 1
    expect(g.cells[`${W.f3North}:${W.subjects.history}`].state).toBe('empty'); // elective nobody chose: optional
  });

  it('shows a teacher only their own part of the grid', async () => {
    const r = await call('academics/assignments', 'GET', { as: await sessionFor(prisma, W.teachers.chikore), query: '?view=grid' });
    expect(r.json.data.classes.map((c: { name: string }) => c.name)).toEqual(['Form 1 North']);
  });

  it('shows each teacher with their periods and a workload bar against the maximum', async () => {
    const r = await call('academics/assignments', 'GET', { as: admin(), query: '?view=teachers' });
    const chikore = r.json.data.teachers.find((x: { id: string }) => x.id === W.teachers.chikore);
    expect(r.json.data.maxPeriods).toBe(8);
    expect(chikore).toMatchObject({ periods: 8, pct: 100, status: 'ok', initials: 'TC' });
    expect(chikore.assignments.length).toBe(2);
    const idle = await addTeacher(prisma, A, 'Mr Idle');
    const withIdle = await call('academics/assignments', 'GET', { as: admin(), query: '?view=teachers' });
    expect(withIdle.json.data.teachers.find((x: { id: string }) => x.id === idle)).toMatchObject({ periods: 0, status: 'none' });
    expect(withIdle.json.data.teachers.find((x: { id: string }) => x.id === W.teachers.dube).status).toBe('under'); // 3 of 8 periods
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { maxPeriodsPerWeek: 6 } });
    const over = await call('academics/assignments', 'GET', { as: admin(), query: '?view=teachers' });
    expect(over.json.data.teachers.find((x: { id: string }) => x.id === W.teachers.chikore).status).toBe('over');
  });

  it('lists every subject a class takes with no teacher, and teachers over or under load', async () => {
    const r = await call('academics/assignments', 'GET', { as: admin(), query: '?view=gaps' });
    expect(r.status).toBe(200);
    expect(r.json.data.gaps.some((g: { className: string; subjectName: string }) => g.className === 'Form 1 North' && g.subjectName === 'Geography')).toBe(true);
    expect(r.json.data.over.map((x: { id: string }) => x.id)).toContain(W.teachers.chikore);
    expect(Array.isArray(r.json.data.under)).toBe(true);
    expect(r.json.data.none.length).toBeGreaterThan(0);
  });
});

describe('copy from last term', () => {
  it('copies class teachers, assignments and subject choices, then leaves what no longer fits', async () => {
    // A closed Term 2 with a class teacher, two assignments (one for a teacher who has left) and a chosen elective.
    const t2 = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-01'), status: 'PLANNED' } });
    const gone = await addTeacher(prisma, A, 'Mr Gone');
    await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: W.f1South, termId: t2.id, userId: W.teachers.dube } });
    await prisma.teacherAssignment.createMany({
      data: [
        { schoolId: A.schoolId, termId: t2.id, teacherId: W.teachers.dube, subjectId: W.subjects.maths, classId: W.f1South, periodsPerWeek: 5, doublesPerWeek: 1, startDate: new Date('2026-05-01') },
        { schoolId: A.schoolId, termId: t2.id, teacherId: gone, subjectId: W.subjects.english, classId: W.f1South, periodsPerWeek: 4, startDate: new Date('2026-05-01') },
      ],
    });
    await prisma.studentSubject.create({ data: { schoolId: A.schoolId, studentId: f2[1]!, subjectId: W.subjects.history, termId: t2.id, source: 'CHOSEN' } });
    await prisma.user.update({ where: { id: gone }, data: { active: false } });
    await prisma.academicTerm.update({ where: { id: t2.id }, data: { status: 'CLOSED' } });

    expect((await call('academics/classes/copy', 'POST', { as: A.users.TEACHER, body: {} })).status).toBe(403);
    const r = await call('academics/classes/copy', 'POST', { as: admin(), body: {} });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ from: 'Term 2 2026', classTeachers: 1, assignments: 1, studentSubjects: 1 });
    expect(r.json.data.skipped.join()).toMatch(/Mr Gone is no longer an active user|Mr Gone/);
    expect(await prisma.classTeacher.findFirstOrThrow({ where: { classId: W.f1South, termId: A.termId } })).toMatchObject({ userId: W.teachers.dube });
    const copied = await prisma.teacherAssignment.findFirstOrThrow({ where: { termId: A.termId, classId: W.f1South, subjectId: W.subjects.maths } });
    expect(copied).toMatchObject({ teacherId: W.teachers.dube, periodsPerWeek: 5, doublesPerWeek: 1, status: 'ACTIVE' });
    expect(await prisma.teacherAssignment.count({ where: { termId: A.termId, classId: W.f1South, subjectId: W.subjects.english } })).toBe(0);
    expect(await prisma.studentSubject.count({ where: { studentId: f2[1]!, subjectId: W.subjects.history, termId: A.termId } })).toBe(1);
    expect((await audit('COPY_FROM_LAST_TERM')).length).toBe(1);
    // Running it again changes nothing.
    const again = await call('academics/classes/copy', 'POST', { as: admin(), body: {} });
    expect(again.json.data).toMatchObject({ classTeachers: 0, assignments: 0, studentSubjects: 0 });
  });

  it('refuses a closed term as the place to copy into', async () => {
    const closed = await prisma.academicTerm.findFirstOrThrow({ where: { schoolId: A.schoolId, name: 'Term 2 2026' } });
    const r = await call('academics/classes/copy', 'POST', { as: admin(), body: { termId: closed.id } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/is closed/);
    // The class teacher and the assignments of a closed term cannot be changed either.
    expect((await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f1South }, body: { termId: closed.id, userId: W.teachers.moyo } })).status).toBe(409);
    expect((await call('academics/assignments', 'POST', { as: admin(), body: mk({ termId: closed.id, subjectId: W.subjects.english, classId: W.f1South }) })).status).toBe(409);
  });
});

describe('another school', () => {
  it('can neither see nor change this school\'s classes, assignments or subjects', async () => {
    const a = await prisma.teacherAssignment.findFirstOrThrow({ where: { schoolId: A.schoolId, status: 'ACTIVE' } });
    for (const [file, method, params, body] of [
      ['academics/assignments/[id]', 'PATCH', { id: a.id }, { periodsPerWeek: 2 }],
      ['academics/assignments/[id]/end', 'POST', { id: a.id }, {}],
      ['academics/assignments/[id]/replace', 'POST', { id: a.id }, { teacherId: B.users.TEACHER.id, effectiveDate: '2026-10-25' }],
      ['academics/classes/[id]', 'GET', { id: W.f1North }, undefined],
      ['academics/classes/[id]/class-teacher', 'PUT', { id: W.f1North }, { userId: B.users.TEACHER.id }],
    ] as const) {
      const r = await call(file, method, { as: B.users.ADMIN, params, body });
      expect(r.status, `${method} ${file}`).toBe(404);
    }
    const mine = await call('academics/assignments', 'GET', { as: B.users.ADMIN });
    expect(mine.json.data.assignments).toEqual([]);
    expect((await call('academics/classes', 'GET', { as: B.users.ADMIN })).json.data.classes.map((c: { id: string }) => c.id)).not.toContain(W.f1North);
  });
});
