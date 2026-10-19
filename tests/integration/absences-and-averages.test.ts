// @vitest-environment node
// Part 4.2 (missing marks, absences, exemptions) and 4.3 (fair overall percentage,
// subjects passed, O Level ranking setting).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const enter = (studentId: string, body: Record<string, unknown>, as = A.users.TEACHER, ids = { subjectId: A.subjectId, classId: A.classId }) =>
  call('results/marks', 'POST', { as, body: { studentId, ...ids, termId: A.termId, ...body } });

describe('4.2 — a subject cannot be verified while a student has no row', () => {
  let second: string;
  beforeAll(async () => {
    const s = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: 'STU2026A2', firstName: 'Second', surname: 'Student', fullName: 'Second Student', gender: 'F', admissionDate: new Date('2026-01-10'), currentClassId: A.classId },
    });
    second = s.id;
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: s.id, classId: A.classId, termId: A.termId, startDate: new Date('2026-01-10') } });
  });

  it('refuses, names the students with no mark, and does not accept "submit anyway"', async () => {
    const r = await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: A.assignmentId, force: true } });
    expect(r.status).toBe(422);
    expect(r.json.message).toMatch(/1 student has no mark: Second Student/);
    expect(r.json.message).toMatch(/Absent or Exempt/);
    expect((await prisma.subjectAssignment.findUniqueOrThrow({ where: { id: A.assignmentId } })).marksStatus).toBe('IN_PROGRESS');
  });

  it('a mark, ABSENT or EXEMPT for everyone lets it through', async () => {
    const absent = await enter(second, { status: 'ABSENT', absenceReason: 'Sick' });
    expect(absent.status).toBe(200);
    expect(absent.json.data.mark).toMatchObject({ status: 'ABSENT', rawMark: 0, percentage: null, letterGrade: null, absenceReason: 'Sick', excused: false });
    const ok = await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: A.assignmentId } });
    expect(ok.status).toBe(200);
    expect((await prisma.subjectAssignment.findUniqueOrThrow({ where: { id: A.assignmentId } })).marksStatus).toBe('VERIFIED');
    // absences are marked as verified once, like scores
    expect((await prisma.mark.findFirstOrThrow({ where: { studentId: second, subjectId: A.subjectId } })).firstVerifiedAt).not.toBeNull();
  });

  it('EXEMPT is accepted too, and needs no score', async () => {
    await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: A.assignmentId } });
    const r = await enter(second, { status: 'EXEMPT', reason: 'Changed from absent to exempt' });
    expect(r.status).toBe(200);
    expect(r.json.data.mark.status).toBe('EXEMPT');
    expect(r.json.data.mark.absenceReason).toBeNull();
  });

  it('a score still needs a mark within range; the status is validated', async () => {
    expect((await enter(second, { status: 'SCORE' })).status).toBe(422);
    expect((await enter(second, { status: 'SCORE', rawMark: 101, reason: 'Too high a mark' })).status).toBe(422);
    expect((await enter(second, { status: 'LATE' })).status).toBe(422);
  });
});

describe('4.2 — ABSENT counts as 0 unless the Head excuses it', () => {
  let classId: string;
  let math: string;
  let eng: string;
  let student: string;
  let absentMark: string;

  beforeAll(async () => {
    const klass = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 East', levelId: A.levelId, stream: 'East' } });
    classId = klass.id;
    math = (await prisma.subject.create({ data: { schoolId: A.schoolId, name: 'Maths E', code: 'E-M' } })).id;
    eng = (await prisma.subject.create({ data: { schoolId: A.schoolId, name: 'English E', code: 'E-E' } })).id;
    for (const subjectId of [math, eng]) {
      await prisma.subjectAssignment.create({
        data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId, classId, termId: A.termId, marksStatus: 'IN_PROGRESS' },
      });
    }
    student = (await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: 'STU2026E1', firstName: 'East', surname: 'One', fullName: 'East One', gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: classId },
    })).id;
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: student, classId, termId: A.termId, startDate: new Date('2026-01-10') } });
    const ids = (subjectId: string) => ({ subjectId, classId });
    await enter(student, { rawMark: 80 }, A.users.TEACHER, ids(eng));
    const abs = await enter(student, { status: 'ABSENT', absenceReason: 'Sick' }, A.users.TEACHER, ids(math));
    absentMark = abs.json.data.mark.id;
    for (const a of await prisma.subjectAssignment.findMany({ where: { classId } })) {
      expect((await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: a.id } })).status).toBe(200);
    }
  });

  const result = () => prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: student, termId: A.termId } } });
  const publish = () => call('results/publish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId } });

  it('the absence counts as 0: (80 + 0) / 2 = 40 %', async () => {
    expect((await publish()).status).toBe(200);
    const r = await result();
    expect(r.subjectsTaken).toBe(2);
    expect(r.averagePercentage?.toNumber()).toBeCloseTo(40);
    expect(r.totalMarks.toNumber()).toBe(80);
  });

  it('only the Head may excuse, with a reason, and only an absence', async () => {
    const body = { markId: absentMark, excused: true, reason: 'Medical certificate seen' };
    for (const role of ['TEACHER', 'DIRECTOR', 'ADMIN', 'BURSAR'] as const) {
      expect((await call('results/marks/excuse', 'POST', { as: A.users[role], body })).status).toBe(403);
    }
    expect((await call('results/marks/excuse', 'POST', { as: A.users.HEAD, body: { ...body, reason: 'no' } })).status).toBe(422);
    const scoreMark = (await prisma.mark.findFirstOrThrow({ where: { studentId: student, subjectId: eng } })).id;
    expect((await call('results/marks/excuse', 'POST', { as: A.users.HEAD, body: { ...body, markId: scoreMark } })).status).toBe(409);
  });

  it('published results must be unpublished first', async () => {
    const r = await call('results/marks/excuse', 'POST', { as: A.users.HEAD, body: { markId: absentMark, excused: true, reason: 'Medical certificate seen' } });
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/Unpublish/);
  });

  it('an excused absence is left out: the average becomes 80 % over one subject', async () => {
    expect((await call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId, reason: 'Excusing a medical absence' } })).status).toBe(200);
    const ok = await call('results/marks/excuse', 'POST', { as: A.users.HEAD, body: { markId: absentMark, excused: true, reason: 'Medical certificate seen' } });
    expect(ok.status).toBe(200);
    expect((await prisma.mark.findUniqueOrThrow({ where: { id: absentMark } })).excused).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'EXCUSE_ABSENCE', entityId: absentMark } })).toBe(1);
    expect((await publish()).status).toBe(200);
    const r = await result();
    expect(r.subjectsTaken).toBe(1);
    expect(r.averagePercentage?.toNumber()).toBeCloseTo(80);
  });

  it('the excuse survives the teacher re-saving the same absence, and ends when it becomes a score', async () => {
    await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: (await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: math } })).id } }).catch(() => null);
    // (the class is published: unpublish, unlock, re-save)
    await call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId, reason: 'Teacher corrects the absence note' } });
    const mathAssignment = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: math } });
    expect((await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: mathAssignment.id } })).status).toBe(200);
    expect((await enter(student, { status: 'ABSENT', absenceReason: 'Sick (note updated)' }, A.users.TEACHER, { subjectId: math, classId })).status).toBe(200);
    expect((await prisma.mark.findUniqueOrThrow({ where: { id: absentMark } })).excused).toBe(true);
    const scored = await enter(student, { rawMark: 60, reason: 'Sat a make-up paper' }, A.users.TEACHER, { subjectId: math, classId });
    expect(scored.status).toBe(200);
    expect((await prisma.mark.findUniqueOrThrow({ where: { id: absentMark } })).excused).toBe(false);
    expect((await prisma.mark.findUniqueOrThrow({ where: { id: absentMark } })).absenceReason).toBeNull();
  });

  it("school B's marks cannot be excused", async () => {
    const mark = await prisma.mark.findFirstOrThrow({ where: { schoolId: B.schoolId } });
    await prisma.mark.update({ where: { id: mark.id }, data: { status: 'ABSENT' } });
    const r = await call('results/marks/excuse', 'POST', { as: A.users.HEAD, body: { markId: mark.id, excused: true, reason: 'Trying another school' } });
    expect(r.status).toBe(404);
    expect((await prisma.mark.findUniqueOrThrow({ where: { id: mark.id } })).excused).toBe(false);
  });
});

describe('4.3 — pass grade and O Level ranking setting', () => {
  let classId: string;
  const students: Record<string, string> = {};

  beforeAll(async () => {
    // Grade boundaries: pass grade C starts at 60.
    await prisma.gradeBoundary.deleteMany({ where: { schoolId: A.schoolId } });
    await prisma.gradeBoundary.createMany({
      data: [['A', 80, 100], ['B', 70, 79.99], ['C', 60, 69.99], ['D', 50, 59.99], ['F', 0, 49.99]].map(([l, min, max]) => ({ schoolId: A.schoolId, letterGrade: l as string, minPercent: min as number, maxPercent: max as number })),
    });
    const klass = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 South', levelId: A.levelId, stream: 'South' } });
    classId = klass.id;
    const subjects: string[] = [];
    for (const k of ['p1', 'p2', 'p3']) {
      const s = await prisma.subject.create({ data: { schoolId: A.schoolId, name: k, code: `S-${k}` } });
      subjects.push(s.id);
      await prisma.subjectAssignment.create({
        data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId: s.id, classId, termId: A.termId, marksStatus: 'VERIFIED' },
      });
    }
    // "steady" passes all three (62, 62, 62) — average 62.
    // "spiky" has one brilliant mark and two fails (100, 40, 40) — average 60, one pass.
    const scores: Record<string, number[]> = { steady: [62, 62, 62], spiky: [100, 40, 40] };
    for (const [key, marks] of Object.entries(scores)) {
      const st = await prisma.student.create({
        data: { schoolId: A.schoolId, admissionNumber: `STU2026S-${key}`, firstName: key, surname: 'S', fullName: `${key} S`, gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: classId },
      });
      students[key] = st.id;
      await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: st.id, classId, termId: A.termId, startDate: new Date('2026-01-10') } });
      for (let i = 0; i < 3; i++) {
        await prisma.mark.create({
          data: { schoolId: A.schoolId, studentId: st.id, subjectId: subjects[i], termId: A.termId, rawMark: marks[i], percentage: marks[i], status: 'VERIFIED', firstVerifiedAt: new Date(), enteredBy: A.users.TEACHER.id },
        });
      }
    }
    // a third student with a higher average but fewer passes than "steady"
    const st = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: 'STU2026S-high', firstName: 'high', surname: 'S', fullName: 'high S', gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: classId },
    });
    students.high = st.id;
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: st.id, classId, termId: A.termId, startDate: new Date('2026-01-10') } });
    const subs = await prisma.subjectAssignment.findMany({ where: { classId }, orderBy: { createdAt: 'asc' } });
    const highScores = [95, 59, 59];
    for (let i = 0; i < 3; i++) {
      await prisma.mark.create({
        data: { schoolId: A.schoolId, studentId: st.id, subjectId: subs[i].subjectId, termId: A.termId, rawMark: highScores[i], percentage: highScores[i], status: 'VERIFIED', firstVerifiedAt: new Date(), enteredBy: A.users.TEACHER.id },
      });
    }
  });

  const result = (key: string) => prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: students[key], termId: A.termId } } });
  const publish = () => call('results/publish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId } });
  const unpublish = () => call('results/unpublish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId, reason: 'Changing the ranking rule' } });

  it('defaults: pass grade C (from the boundaries), ranked by average percentage', async () => {
    expect((await call('results/settings', 'GET', { as: A.users.HEAD })).json.data).toEqual({ passGrade: 'C', oLevelRanking: 'AVERAGE' });
    expect((await publish()).status).toBe(200);
    // averages: steady 62, spiky 60, high 71 → high, steady, spiky
    expect((await result('high')).classPosition).toBe(1);
    expect((await result('steady')).classPosition).toBe(2);
    expect((await result('spiky')).classPosition).toBe(3);
    // passes at C (60 %): steady 3, spiky 1, high 1
    expect((await result('steady')).subjectsPassed).toBe(3);
    expect((await result('spiky')).subjectsPassed).toBe(1);
    expect((await result('high')).subjectsPassed).toBe(1);
    expect((await result('steady')).subjectsTaken).toBe(3);
    expect((await result('steady')).averagePercentage?.toNumber()).toBeCloseTo(62);
  });

  it('only HEAD, DIRECTOR and ADMIN may change the settings; values are validated', async () => {
    for (const role of ['TEACHER', 'BURSAR', 'LIBRARIAN'] as const) {
      expect((await call('results/settings', 'PATCH', { as: A.users[role], body: { oLevelRanking: 'PASSES_THEN_AVERAGE' } })).status).toBe(403);
    }
    expect((await call('results/settings', 'PATCH', { as: A.users.HEAD, body: { oLevelRanking: 'BY_HEIGHT' } })).status).toBe(422);
    expect((await call('results/settings', 'PATCH', { as: A.users.HEAD, body: {} })).status).toBe(422);
    const unknown = await call('results/settings', 'PATCH', { as: A.users.HEAD, body: { passGrade: 'Z' } });
    expect(unknown.status).toBe(422);
    expect(unknown.json.message).toMatch(/No grade "Z"/);
  });

  it('PASSES_THEN_AVERAGE ranks the steady student first, then the higher average', async () => {
    const set = await call('results/settings', 'PATCH', { as: A.users.ADMIN, body: { oLevelRanking: 'PASSES_THEN_AVERAGE' } });
    expect(set.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'UPDATE_SCHOOL_SETTINGS', detail: { contains: 'passes then average' } } })).toBe(1);
    expect((await unpublish()).status).toBe(200);
    expect((await publish()).status).toBe(200);
    // passes: steady 3 | high 1 (avg 71) | spiky 1 (avg 60)
    expect((await result('steady')).classPosition).toBe(1);
    expect((await result('high')).classPosition).toBe(2);
    expect((await result('spiky')).classPosition).toBe(3);
  });

  it('a different pass grade changes how many subjects count as passed', async () => {
    expect((await call('results/settings', 'PATCH', { as: A.users.HEAD, body: { passGrade: 'D' } })).status).toBe(200);
    expect((await unpublish()).status).toBe(200);
    expect((await publish()).status).toBe(200);
    // D starts at 50 %: steady 3, high 3 (95, 59, 59), spiky 1
    expect((await result('high')).subjectsPassed).toBe(3);
    expect((await result('spiky')).subjectsPassed).toBe(1);
    // passes tie (3 and 3) → average decides: high (71) before steady (62)
    expect((await result('high')).classPosition).toBe(1);
    expect((await result('steady')).classPosition).toBe(2);
  });

  it('A Level classes always rank by average, whatever the O Level setting', async () => {
    const aLevel = await prisma.level.create({ data: { schoolId: A.schoolId, name: 'Form 5', order: 5, category: 'A_LEVEL' } });
    const klass = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 5 Arts', levelId: aLevel.id, stream: 'Arts' } });
    const subj = await prisma.subject.create({ data: { schoolId: A.schoolId, name: 'Lit', code: 'AL-1' } });
    await prisma.subjectAssignment.create({ data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId: subj.id, classId: klass.id, termId: A.termId, marksStatus: 'VERIFIED' } });
    const subj2 = await prisma.subject.create({ data: { schoolId: A.schoolId, name: 'Hist', code: 'AL-2' } });
    await prisma.subjectAssignment.create({ data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId: subj2.id, classId: klass.id, termId: A.termId, marksStatus: 'VERIFIED' } });
    const mk = async (name: string, scores: number[]) => {
      const s = await prisma.student.create({ data: { schoolId: A.schoolId, admissionNumber: `STU2026AL-${name}`, firstName: name, surname: 'AL', fullName: `${name} AL`, gender: 'F', admissionDate: new Date('2026-01-10'), currentClassId: klass.id } });
      await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: s.id, classId: klass.id, termId: A.termId, startDate: new Date('2026-01-10') } });
      for (const [i, sub] of Array.from([subj, subj2].entries())) {
        await prisma.mark.create({ data: { schoolId: A.schoolId, studentId: s.id, subjectId: sub.id, termId: A.termId, rawMark: scores[i], percentage: scores[i], status: 'VERIFIED', firstVerifiedAt: new Date(), enteredBy: A.users.TEACHER.id } });
      }
      return s.id;
    };
    const passes = await mk('passes', [60, 60]); // 2 passes, average 60
    const spike = await mk('spike', [95, 20]);   // 1 pass, average 57.5
    const high = await mk('high', [90, 40]);     // 1 pass, average 65 → first by average
    await call('results/settings', 'PATCH', { as: A.users.HEAD, body: { passGrade: 'D', oLevelRanking: 'PASSES_THEN_AVERAGE' } });
    expect((await call('results/publish', 'POST', { as: A.users.HEAD, body: { classId: klass.id, termId: A.termId } })).status).toBe(200);
    const pos = async (id: string) => (await prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: id, termId: A.termId } } })).classPosition;
    expect([await pos(high), await pos(passes), await pos(spike)]).toEqual([1, 2, 3]); // by average, not by passes
  });
});
