// @vitest-environment node
// Part 4.4 (class size), 4.5 (grade boundaries per level, frozen grades), 4.6 (report card content).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

const pdf = vi.hoisted(() => ({ data: null as null | Record<string, unknown> }));

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));
// Capture what goes onto the report card instead of rendering a PDF.
vi.mock('@react-pdf/renderer', () => {
  const Pass = ({ children }: { children?: unknown }) => children;
  return {
    Document: Pass, Page: Pass, View: Pass, Text: Pass,
    StyleSheet: { create: <T,>(s: T) => s },
    renderToStream: async (el: { props: { data: Record<string, unknown> } }) => {
      pdf.data = el.props.data;
      return { on: (event: string, cb: () => void) => { if (event === 'end') setTimeout(cb, 0); } };
    },
  };
});

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const save = (body: Record<string, unknown>, as = A.operator!) => call('results/grade-boundaries', 'POST', { as, body });
const set = (...r: [string, number, number][]) => r.map(([letterGrade, minPercent, maxPercent]) => ({ letterGrade, minPercent, maxPercent }));

describe('4.5 — saving grade boundaries', () => {
  it('rejects overlaps and gaps with a clear message and saves nothing', async () => {
    const overlap = await save({ boundaries: set(['A', 75, 100], ['B', 0, 80]) });
    expect(overlap.status).toBe(422);
    expect(overlap.json.message).toMatch(/overlap/);
    const gap = await save({ boundaries: set(['A', 80, 100], ['B', 0, 59]) });
    expect(gap.status).toBe(422);
    expect(gap.json.message).toMatch(/Gap between 59% and 80%/);
    expect((await save({ boundaries: set(['A', 80, 100], ['B', 10, 79]) })).json.message).toMatch(/start at 0%/);
    expect((await save({ boundaries: set(['A', 80, 95], ['B', 0, 79]) })).json.message).toMatch(/end at 100%/);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId, letterGrade: { in: ['B'] } } })).toBe(0);
  });

  it('saves a valid school-wide set and keeps sets for a level apart', async () => {
    expect((await save({ boundaries: set(['A', 80, 100], ['B', 70, 79], ['C', 60, 69], ['D', 50, 59], ['E', 40, 49], ['F', 0, 39]) })).status).toBe(200);
    // O Level (Form 1 here) is stricter than the school-wide set
    const o = await save({ levelId: A.levelId, boundaries: set(['A', 75, 100], ['B', 65, 74.99], ['C', 55, 64.99], ['F', 0, 54.99]) });
    expect(o.status).toBe(200);
    const rows = await prisma.gradeBoundary.findMany({ where: { schoolId: A.schoolId } });
    expect(rows.filter((r) => r.levelId === null)).toHaveLength(6);
    expect(rows.filter((r) => r.levelId === A.levelId)).toHaveLength(4);
    // saving one set again replaces only that set
    await save({ levelId: A.levelId, boundaries: set(['A', 75, 100], ['B', 65, 74.99], ['C', 55, 64.99], ['F', 0, 54.99]) });
    expect((await prisma.gradeBoundary.findMany({ where: { schoolId: A.schoolId, levelId: A.levelId } }))).toHaveLength(4);
    expect((await prisma.gradeBoundary.findMany({ where: { schoolId: A.schoolId, levelId: null } }))).toHaveLength(6);
    expect(await prisma.auditLog.count({ where: { action: 'UPDATE_GRADE_BOUNDARIES' } })).toBeGreaterThanOrEqual(3);
  });

  it('only HEAD, DIRECTOR and ADMIN may save; a foreign level or term is not found', async () => {
    expect((await save({ boundaries: set(['X', 0, 100]) }, A.users.TEACHER)).status).toBe(403);
    expect((await save({ levelId: B.levelId, boundaries: set(['X', 0, 100]) })).status).toBe(404);
    expect((await save({ termId: B.termId, boundaries: set(['X', 0, 100]) })).status).toBe(404);
  });

  it('a level set can be removed but the school-wide set cannot', async () => {
    expect((await call('results/grade-boundaries', 'DELETE', { as: A.operator! })).status).toBe(409);
    await save({ levelId: A.levelId, termId: A.termId, boundaries: set(['Z', 0, 100]) });
    const del = await call('results/grade-boundaries', 'DELETE', { as: A.operator!, query: `?levelId=${A.levelId}&termId=${A.termId}` });
    expect(del.status).toBe(200);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId, termId: A.termId } })).toBe(0);
    expect(await prisma.gradeBoundary.count({ where: { schoolId: A.schoolId } })).toBe(10);
  });

  it("the database refuses boundaries that point into another school", async () => {
    await expect(
      t.pg.exec(`INSERT INTO "GradeBoundary" ("id","schoolId","levelId","minPercent","maxPercent","letterGrade") VALUES ('gb-x','${A.schoolId}','${B.levelId}',0,100,'Q')`),
    ).rejects.toThrow(/Cross-school reference/);
  });
});

describe('4.5 — grades follow the level and are frozen when published', () => {
  const mark = (studentId: string, rawMark: number) =>
    call('results/marks', 'POST', { as: A.users.TEACHER, body: { studentId, subjectId: A.subjectId, classId: A.classId, termId: A.termId, rawMark } });

  it('a mark is graded with the boundaries of its level and remembers the band', async () => {
    await prisma.mark.deleteMany({ where: { id: A.markId } });
    const r = await mark(A.studentId, 70);
    // Form 1 (the level with its own set): 65–74.99 is a B; the school-wide set would say B too (70–79) — use 60 to tell them apart
    expect(r.json.data.mark.letterGrade).toBe('B');
    const r2 = await mark(A.studentId, 60);
    expect(r2.json.data.mark).toMatchObject({ letterGrade: 'C' }); // level set: 55–64.99; school-wide would also say C (60–69)
    const r3 = await mark(A.studentId, 57);
    expect(r3.json.data.mark.letterGrade).toBe('C'); // level set: C; the school-wide set would say D
    const row = await prisma.mark.findUniqueOrThrow({ where: { id: r3.json.data.mark.id } });
    expect(row.gradeMinPercent?.toNumber()).toBe(55);
    expect(row.gradeMaxPercent?.toNumber()).toBe(64.99);
  });

  it('publishing freezes the grades: later boundary edits change nothing that is published', async () => {
    const m = await prisma.mark.findFirstOrThrow({ where: { studentId: A.studentId, subjectId: A.subjectId } });
    expect((await call('results/marks/verify', 'POST', { as: A.operator!, body: { assignmentId: A.assignmentId } })).status).toBe(200);
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId } })).status).toBe(200);
    const result = await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } });
    expect(result.letterGrade).toBe('C');
    expect(result.classSize).toBe(1);

    // The Head now makes the level much easier …
    expect((await save({ levelId: A.levelId, boundaries: set(['A', 50, 100], ['F', 0, 49.99]) })).status).toBe(200);
    // … but nothing already published moves
    const after = await prisma.mark.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.letterGrade).toBe('C');
    expect(after.gradeMinPercent?.toNumber()).toBe(55);
    expect((await prisma.termResult.findUniqueOrThrow({ where: { id: result.id } })).letterGrade).toBe('C');
  });

  it('only republishing re-grades, with the boundaries then in force', async () => {
    expect((await call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId, reason: 'Boundaries were wrong' } })).status).toBe(200);
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId } })).status).toBe(200);
    const m = await prisma.mark.findFirstOrThrow({ where: { studentId: A.studentId, subjectId: A.subjectId } });
    expect(m.letterGrade).toBe('A');
    expect(m.gradeMinPercent?.toNumber()).toBe(50);
    expect((await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } })).letterGrade).toBe('A');
  });
});

describe('4.4 / 4.6 — class size, remarks, days and the report card', () => {
  let nextTermStart: Date;
  let otherTeacher: (typeof A.users)['TEACHER'];

  beforeAll(async () => {
    const next = await prisma.academicTerm.create({
      data: { schoolId: A.schoolId, academicYearId: A.yearId, termNumber: 2, name: 'Term 2 2026', startDate: new Date('2027-01-12'), endDate: new Date('2027-04-20') },
    });
    nextTermStart = next.startDate;
    const u = await prisma.user.create({ data: { schoolId: A.schoolId, fullName: 'Other Teacher', email: 'other@schoola.test', role: 'TEACHER', passwordHash: 'x' } });
    otherTeacher = { id: u.id, email: u.email, schoolId: A.schoolId, role: 'TEACHER', fullName: u.fullName };
  });

  const remarks = (body: Record<string, unknown>, as = A.users.HEAD) =>
    call('results/remarks', 'PATCH', { as, body: { studentId: A.studentId, termId: A.termId, ...body } });

  it('publishing stores the class size and the date the next term starts', async () => {
    expect((await call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId, reason: 'Publish again for the next term date' } })).status).toBe(200);
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId } })).status).toBe(200);
    const r = await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } });
    expect(r.classSize).toBe(1);
    expect(r.nextTermStartDate?.toISOString().slice(0, 10)).toBe('2027-01-12');
  });

  it('the Head can write every field; the class teacher can write their remark and the days', async () => {
    const head = await remarks({ headRemark: 'A pleasing term.', classTeacherRemark: 'Works well.', daysPresent: 58, daysAbsent: 2 });
    expect(head.status).toBe(200);
    expect(head.json.data).toMatchObject({ headRemark: 'A pleasing term.', classTeacherRemark: 'Works well.', daysPresent: 58, daysAbsent: 2 });
    const ct = await remarks({ classTeacherRemark: 'Works very well.', daysPresent: 59 }, A.users.TEACHER);
    expect(ct.status).toBe(200);
    const r = await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } });
    expect(r).toMatchObject({ classTeacherRemark: 'Works very well.', headRemark: 'A pleasing term.', daysPresent: 59, daysAbsent: 2 });
    expect(r.published).toBe(true); // the extras do not touch the results
    expect(await prisma.auditLog.count({ where: { action: 'UPDATE_REPORT_CARD', entityId: r.id } })).toBe(2);
  });

  it("the class teacher cannot write the Head's remark; other staff cannot write anything", async () => {
    const r = await remarks({ headRemark: 'Sneaky' }, A.users.TEACHER);
    expect(r.status).toBe(403);
    expect(r.json.message).toMatch(/Only the Head/);
    for (const as of [otherTeacher, A.users.BURSAR, A.users.LIBRARIAN]) { // (the Owner holds "*" until the switch)
      expect((await remarks({ classTeacherRemark: 'x' }, as)).status).toBe(403);
    }
    expect((await remarks({}, A.users.HEAD)).status).toBe(422);
    expect((await remarks({ daysPresent: -1 })).status).toBe(422);
    expect((await remarks({ daysAbsent: 1.5 })).status).toBe(422);
    expect((await remarks({ headRemark: 'x'.repeat(501) })).status).toBe(422);
  });

  it("another school's student cannot be reached", async () => {
    const r = await call('results/remarks', 'PATCH', { as: A.users.HEAD, body: { studentId: B.studentId, termId: A.termId, headRemark: 'Hello' } });
    expect(r.status).toBe(404);
    expect(await prisma.termResult.count({ where: { studentId: B.studentId, headRemark: 'Hello' } })).toBe(0);
  });

  it('a remark written before publishing is kept when the class is published', async () => {
    const s = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: 'STU2026R2', firstName: 'Remark', surname: 'Early', fullName: 'Remark Early', gender: 'F', admissionDate: new Date('2026-01-10'), currentClassId: A.classId },
    });
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: s.id, classId: A.classId, termId: A.termId, startDate: new Date('2026-01-10') } });
    const early = await call('results/remarks', 'PATCH', { as: A.users.HEAD, body: { studentId: s.id, termId: A.termId, headRemark: 'Written early', daysPresent: 40 } });
    expect(early.status).toBe(200);
    const placeholder = await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: s.id, termId: A.termId } } });
    expect(placeholder.published).toBe(false);
    // give them a mark so the class can be published, then publish
    expect((await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: A.assignmentId } })).status).toBe(409); // still published
    expect((await call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId, reason: 'A new student joined the class' } })).status).toBe(200);
    await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: A.assignmentId } });
    expect((await call('results/marks', 'POST', { as: A.users.TEACHER, body: { studentId: s.id, subjectId: A.subjectId, classId: A.classId, termId: A.termId, rawMark: 66 } })).status).toBe(200);
    expect((await call('results/marks/verify', 'POST', { as: A.operator!, body: { assignmentId: A.assignmentId } })).status).toBe(200);
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: A.classId, termId: A.termId } })).status).toBe(200);
    const after = await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: s.id, termId: A.termId } } });
    expect(after).toMatchObject({ published: true, headRemark: 'Written early', daysPresent: 40, classSize: 2 });
    expect((await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: A.studentId, termId: A.termId } } })).classSize).toBe(2);
  });

  it('the report card shows admission number, level, stream, "Position 2 of 2", remarks, days and next term', async () => {
    const r = await call('results/reports/[studentId]', 'GET', { as: A.users.HEAD, params: { studentId: A.studentId }, query: `?termId=${A.termId}` });
    expect(r.status).toBe(200);
    const d = pdf.data!;
    const student = await prisma.student.findUniqueOrThrow({ where: { id: A.studentId } });
    expect(d).toMatchObject({
      studentName: student.fullName,
      admissionNumber: student.admissionNumber,
      level: 'Form 1',
      stream: 'North',
      classPosition: 2, // 57 % behind the new student on 66 %
      classSize: 2,
      classTeacherRemark: 'Works very well.',
      headRemark: 'A pleasing term.',
      daysPresent: 59,
      daysAbsent: 2,
      nextTermStartDate: '2027-01-12',
    });
    expect(nextTermStart.toISOString().slice(0, 10)).toBe('2027-01-12');
  });

  it('a closed term locks the remarks', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED', closedAt: new Date() } });
    const r = await remarks({ headRemark: 'Too late' });
    expect(r.status).toBe(409);
  });
});
