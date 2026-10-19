// @vitest-environment node
// Academic analytics: the Head's weekly questions answered from the registers, schemes, assignments and timetable, with
// filters, the department scope of a head of department, CSV export of every panel and the audit entry of an export.
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
let k1: string[];
let k2: string[];
let hod: Awaited<ReturnType<typeof sessionFor>>;

const admin = () => A.users.ADMIN;
const get = (query = '', as = admin()) => call('academics/analytics', 'GET', { as, query });

/** A morning register straight into the database: marks by student, default present, marked at the given time. */
async function register(classId: string, date: string, marks: Record<string, 'ABSENT' | 'LATE' | 'EXCUSED'>, ids: string[], markedAt = `${date}T06:00:00Z`) {
  const r = await prisma.attendanceRegister.create({ data: { schoolId: A.schoolId, termId: A.termId, classId, date: new Date(date), session: 'AM', markedById: admin().id, markedAt: new Date(markedAt), changedAt: new Date(markedAt) } });
  await prisma.attendanceEntry.createMany({
    data: ids.map((studentId) => ({
      schoolId: A.schoolId, registerId: r.id, studentId, status: marks[studentId] ?? 'PRESENT',
      ...(marks[studentId] === 'EXCUSED' ? { reason: 'SICK' as const } : {}), ...(marks[studentId] === 'LATE' ? { arrivalTime: '08:20' } : {}),
    })),
  });
}

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await buildWorld(prisma, A);
  k1 = [A.studentId, ...(await students(prisma, A, W.f1North, 3, 'One'))]; // 4 in Form 1 North (2 boys, 2 girls)
  k2 = await students(prisma, A, W.f2East, 2, 'Two'); // 2 in Form 2 East
  await prisma.student.update({ where: { id: k1[1]! }, data: { boarding: 'BOARDER' } });
  await call('academics/classes/[id]/class-teacher', 'PUT', { as: admin(), params: { id: W.f1North }, body: { userId: W.teachers.chikore } });

  // Registers: Form 1 North on six days, Form 2 East on two.
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13'];
  const a1 = k1[1]!, a2 = k1[2]!;
  for (const [i, d] of days.entries()) {
    await register(W.f1North, d, { [a1]: 'ABSENT', ...(i < 3 ? { [a2]: 'LATE' as const } : {}) }, k1, i === 5 ? `${d}T15:00:00Z` : undefined); // the last one marked a day late? no: later the same day
  }
  await register(W.f1North, '2026-10-14', { [a1]: 'ABSENT', [k1[3]!]: 'EXCUSED' }, k1, '2026-10-15T07:00:00Z'); // marked the next day: not on time
  await register(W.f2East, '2026-10-13', {}, k2);
  await register(W.f2East, '2026-10-14', { [k2[0]!]: 'ABSENT' }, k2);

  // A scheme with a record, an unfinished one, a gap and an unplaced lesson.
  const algebra = await prisma.syllabusTopic.create({ data: { schoolId: A.schoolId, subjectId: W.subjects.maths, levelId: W.form1, title: 'Algebra' } });
  const geometry = await prisma.syllabusTopic.create({ data: { schoolId: A.schoolId, subjectId: W.subjects.maths, levelId: W.form1, title: 'Geometry' } });
  const maths = await assign(prisma, A, { teacherId: W.teachers.chikore, subjectId: W.subjects.maths, classId: W.f1North, periods: 4 });
  const eng = await assign(prisma, A, { teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f1North, periods: 40 });
  const sci = await assign(prisma, A, { teacherId: W.teachers.ncube, subjectId: W.subjects.science, classId: W.f1North, periods: 3 });
  const scheme = await prisma.schemeOfWork.create({ data: { schoolId: A.schoolId, termId: A.termId, assignmentId: maths.id, status: 'APPROVED', approvedById: A.users.HEAD.id, approvedAt: NOW } });
  const w1 = await prisma.schemeWeek.create({ data: { schoolId: A.schoolId, schemeId: scheme.id, weekNo: 1, startDate: new Date('2026-09-01'), topicIds: [algebra.id] } });
  await prisma.schemeWeek.create({ data: { schoolId: A.schoolId, schemeId: scheme.id, weekNo: 2, startDate: new Date('2026-09-08'), topicIds: [geometry.id] } });
  await prisma.schemeWeek.create({ data: { schoolId: A.schoolId, schemeId: scheme.id, weekNo: 3, startDate: new Date('2026-12-01'), topicIds: [] } });
  await prisma.recordOfWork.create({ data: { schoolId: A.schoolId, schemeWeekId: w1.id, coveredTopicIds: [algebra.id], recordedById: W.teachers.chikore } });
  await prisma.schemeOfWork.create({ data: { schoolId: A.schoolId, termId: A.termId, assignmentId: eng.id, status: 'DRAFT' } });
  await prisma.academicTerm.update({ where: { id: A.termId }, data: { schemeDueDate: new Date('2026-09-08') } });
  void sci;

  // Mr Chikore takes two covers; the HOD of Sciences gets the department scope.
  const hodId = await addTeacher(prisma, A, 'Mrs Sciences Head', ['HOD']);
  await prisma.department.update({ where: { id: W.dept.sciences }, data: { hodUserId: hodId } });
  await grantPermission(prisma, A.schoolId, 'HOD', 'academics.analytics.view');
  hod = await sessionFor(prisma, hodId);
  const tt = await prisma.timetable.create({ data: { schoolId: A.schoolId, termId: A.termId, version: 1, status: 'PUBLISHED', approvedById: admin().id, effectiveFrom: new Date('2026-09-01') } });
  const slot = await prisma.timetableSlot.create({ data: { schoolId: A.schoolId, timetableId: tt.id, assignmentId: eng.id, periodId: W.periods[0]!.id, teacherId: W.teachers.moyo, classId: W.f1North } });
  for (const d of ['2026-10-05', '2026-10-06']) await prisma.coverLesson.create({ data: { schoolId: A.schoolId, date: new Date(d), slotId: slot.id, absentTeacherId: W.teachers.moyo, coverTeacherId: W.teachers.chikore, assignedById: admin().id } });
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
  await t.stop();
});

describe('who sees the page', () => {
  it('needs academics.analytics.view', async () => {
    expect((await get('', A.users.TEACHER)).status).toBe(403);
    expect((await get('', null as never)).status).toBe(401);
    expect((await get('', admin())).status).toBe(200);
    expect((await get('', B.users.ADMIN)).json.data.attendance.byClass).toEqual([]); // another school sees only its own
  });
});

describe('attendance rate', () => {
  it('is the present % this term by form and by class, with the trend by week', async () => {
    const d = (await get()).json.data;
    expect(d.scope).toBe('SCHOOL');
    const f1 = d.attendance.byClass.find((c: { class: string }) => c.class === 'Form 1 North');
    // Seven registers of four students: student 1 is absent on all seven; student 2 late three times; student 3 excused once.
    expect(f1).toMatchObject({ absent: 7, late: 3, excused: 1 });
    expect(f1.rate).toBe(Math.round(((28 - 7 - 1) / 28) * 1000) / 10);
    expect(d.attendance.byForm.map((f: { form: string }) => f.form)).toEqual(['Form 1', 'Form 2']);
    expect(d.attendance.byForm.find((f: { form: string }) => f.form === 'Form 2').rate).toBe(75);
    expect(d.attendance.trend.length).toBeGreaterThanOrEqual(2);
    expect(d.attendance.trend.map((x: { week: number }) => x.week)).toEqual(d.attendance.trend.map((_: unknown, i: number) => i + 1));
    expect(d.attendance.threshold).toBe(90);
  });

  it('can be filtered by form and by class', async () => {
    const f2 = (await get(`?formId=${W.form2}`)).json.data;
    expect(f2.attendance.byClass.map((c: { class: string }) => c.class)).toEqual(['Form 2 East']);
    const one = (await get(`?classId=${W.f1North}`)).json.data;
    expect(one.attendance.byClass.map((c: { class: string }) => c.class)).toEqual(['Form 1 North']);
    expect(one.filters).toMatchObject({ classId: W.f1North });
  });

  it('breaks down boys and girls, boarders and day scholars, and the days of the week', async () => {
    const g = (await get()).json.data.groups;
    expect(g.gender.map((x: { group: string }) => x.group).sort()).toEqual(['Boys', 'Girls']);
    expect(g.boarding.map((x: { group: string }) => x.group).sort()).toEqual(['Boarders', 'Day scholars']);
    expect(g.boarding.find((x: { group: string }) => x.group === 'Boarders').rate).toBe(0); // the boarder is the one always absent
    expect(g.dayOfWeek.map((x: { day: string }) => x.day)).toEqual(expect.arrayContaining(['Monday', 'Tuesday', 'Wednesday']));
  });
});

describe('chronic absence', () => {
  it('lists students below the threshold or absent several days in a row, with class and guardian phone', async () => {
    const rows = (await get()).json.data.chronic as { student: string; class: string; rate: number; streak: number; reason: string; guardianPhone: string | null }[];
    const always = rows.find((r) => r.streak >= 7)!;
    expect(always).toMatchObject({ class: 'Form 1 North', rate: 0 });
    expect(always.reason).toMatch(/Below threshold and absent in a row/);
    expect(always.guardianPhone).toMatch(/^\+/);
    // The student who was late three times and present otherwise is fine; the one absent once at the end is not listed.
    expect(rows.every((r) => r.rate === null || r.rate < 90 || r.streak >= 3)).toBe(true);
  });

  it('follows the school\'s own thresholds', async () => {
    await prisma.academicsSettings.upsert({ where: { schoolId: A.schoolId }, update: { attendanceThresholdPct: 50, consecutiveAbsentDays: 10 }, create: { schoolId: A.schoolId, attendanceThresholdPct: 50, consecutiveAbsentDays: 10 } });
    const rows = (await get()).json.data.chronic;
    expect(rows.every((r: { rate: number }) => r.rate < 50)).toBe(true);
    await prisma.academicsSettings.update({ where: { schoolId: A.schoolId }, data: { attendanceThresholdPct: 90, consecutiveAbsentDays: 3 } });
  });
});

describe('register compliance', () => {
  it('counts registers marked on the day, by class teacher, and the days missed', async () => {
    const rows = (await get()).json.data.compliance as { class: string; classTeacher: string | null; schoolDays: number; marked: number; onTime: number; missed: number; missedDays: string[]; onTimePct: number }[];
    const f1 = rows.find((r) => r.class === 'Form 1 North')!;
    expect(f1).toMatchObject({ classTeacher: 'Mr Tendai Chikore', marked: 7 });
    expect(f1.onTime).toBe(6); // the register for 14 October was marked on the 15th
    expect(f1.missed).toBe(f1.schoolDays - 7);
    expect(f1.missedDays.length).toBeGreaterThan(0);
    expect(f1.onTimePct).toBe(Math.round((6 / f1.schoolDays) * 100));
    expect(rows.find((r) => r.class === 'Form 2 East')!.marked).toBe(2);
  });
});

describe('syllabus coverage and scheme compliance', () => {
  it('shows coverage by department and subject against where it should be by this week', async () => {
    const c = (await get()).json.data.coverage;
    const sci = c.byDepartment.find((d: { name: string }) => d.name === 'Sciences');
    expect(sci).toMatchObject({ due: 2, covered: 1, coverage: 50 });
    expect(sci.plannedByNow).toBe(100); // both planned topics fall due before today
    expect(c.bySubject.find((s: { name: string }) => s.name === 'Mathematics')).toMatchObject({ coverage: 50 });
    expect(c.schemes.find((s: { subject: string }) => s.subject === 'Maths')).toMatchObject({ teacher: 'Mr Tendai Chikore', coverage: 50 });
  });

  it('counts schemes submitted, approved and late, by teacher', async () => {
    const s = (await get()).json.data.schemes;
    expect(s.dueDate).toBe('2026-09-08');
    expect(s.counts).toMatchObject({ total: 3, approved: 1, draft: 1, none: 1, late: 2 });
    expect(s.rows[0].late).toBe(true);
    expect(s.rows.find((r: { subject: string }) => r.subject === 'Maths')).toMatchObject({ status: 'APPROVED', late: false });
  });
});

describe('teaching load and gaps', () => {
  it('shows periods per teacher against the maximum and the cover lessons taken', async () => {
    const l = (await get()).json.data.load;
    expect(l.maxPeriods).toBe(36);
    const mr = l.teachers.find((x: { name: string }) => x.name === 'Mr Tendai Chikore');
    expect(mr).toMatchObject({ periods: 4, covers: 2, status: 'under' });
    expect(l.teachers.find((x: { name: string }) => x.name === 'Mrs Rudo Moyo')).toMatchObject({ periods: 40, status: 'over' });
  });

  it('lists subjects without a teacher and classes with unplaced lessons', async () => {
    const g = (await get()).json.data.gaps;
    expect(g.subjects.some((x: { className: string; subjectName: string }) => x.className === 'Form 1 North' && x.subjectName === 'Geography')).toBe(true);
    expect(g.unplaced.some((u: { subject: string; target: string; placed: number; needed: number }) => u.subject === 'Maths' && u.target === 'Form 1 North' && u.placed === 0 && u.needed === 4)).toBe(true);
  });
});

describe('a head of department', () => {
  it('sees the department-level panels for their own department only', async () => {
    const d = (await get('', hod)).json.data;
    expect(d.scope).toBe('DEPARTMENT');
    expect(d.attendance).toBeNull();
    expect(d.chronic).toBeNull();
    expect(d.compliance).toBeNull();
    expect(d.options.departments.map((x: { name: string }) => x.name)).toEqual(['Sciences']);
    expect(d.coverage.byDepartment.map((x: { name: string }) => x.name)).toEqual(['Sciences']);
    expect(d.schemes.rows.map((r: { subject: string }) => r.subject).sort()).toEqual(['Comb Sci', 'Maths']);
    expect(d.load.teachers.map((x: { name: string }) => x.name).sort()).toEqual(['Mr Tendai Chikore', 'Ms Thando Ncube']);
    // Asking for another department changes nothing.
    const other = (await get(`?departmentId=${W.dept.humanities}`, hod)).json.data;
    expect(other.coverage.byDepartment.map((x: { name: string }) => x.name)).toEqual(['Sciences']);
  });

  it('is filtered for the school by department too', async () => {
    const d = (await get(`?departmentId=${W.dept.languages}`)).json.data;
    expect(d.schemes.rows.map((r: { subject: string }) => r.subject)).toEqual(['English']);
  });
});

describe('export and print', () => {
  const exp = (panel: string, query = '', as = admin()) => call('academics/analytics/export', 'GET', { as, query: `?panel=${panel}${query}` });

  it('exports every panel to CSV, with the filters, and logs it', async () => {
    for (const [panel, header] of [
      ['attendance', 'Level,Name,Present %'], ['chronic', 'Student,Class,Attendance %'], ['compliance', 'Class,Class teacher,School days'], ['groups', 'Kind,Group,Present %'],
      ['coverage', 'Level,Name,Covered'], ['schemes', 'Teacher,Subject,Class,Status,Late'], ['load', 'Teacher,Periods a week'], ['gaps', 'Kind,Class,Subject,Detail'],
    ] as const) {
      const r = await exp(panel);
      expect(r.status, panel).toBe(200);
      expect(r.response.headers.get('content-type')).toMatch(/text\/csv/);
      expect(r.response.headers.get('content-disposition')).toMatch(/Term-1-2026/);
      expect(r.text.startsWith(header), panel).toBe(true);
    }
    const audited = await prisma.auditLog.findMany({ where: { schoolId: A.schoolId, action: 'EXPORT_ACADEMICS' } });
    expect(audited.length).toBe(8);
    const filtered = await exp('attendance', `&classId=${W.f2East}`);
    expect(filtered.text).toMatch(/Form 2 East/);
    expect(filtered.text).not.toMatch(/Form 1 North/);
  });

  it('refuses an unknown panel and people without the permission, and never starts a cell with a formula', async () => {
    expect((await exp('secrets')).status).toBe(404);
    expect((await exp('attendance', '', A.users.TEACHER)).status).toBe(403);
    await prisma.student.update({ where: { id: k1[1]! }, data: { fullName: '=HYPERLINK("http://x")' } });
    const chronic = await exp('chronic');
    expect(chronic.text).toContain(`'=HYPERLINK`);
    await prisma.student.update({ where: { id: k1[1]! }, data: { fullName: 'Kid1 Kid' } });
  });
});
