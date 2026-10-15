// @vitest-environment node
// Part 4 — what happens after results are published, and fair class positions.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { call } from '../helpers/route';

vi.mock('@/lib/auth', async () => ({ auth: (await import('../helpers/session')).mockAuth }));

let t: TestDb;
let A: SeededSchool;
let prisma: typeof import('@/lib/prisma').prisma;

// A class with 4 core and 2 elective subjects and six students who did not all sit the same papers.
let classId: string;
const subjects: Record<string, string> = {};
const students: Record<string, string> = {};

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  A = await seedSchool(prisma, 'School A');

  const klass = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 1 West', levelId: A.levelId, stream: 'West' } });
  classId = klass.id;

  for (const [key, type] of [['eng', 'CORE'], ['math', 'CORE'], ['sci', 'CORE'], ['hist', 'CORE'], ['art', 'ELECTIVE'], ['music', 'ELECTIVE']] as const) {
    const s = await prisma.subject.create({ data: { schoolId: A.schoolId, name: key.toUpperCase(), code: `W-${key}`, type } });
    subjects[key] = s.id;
    await prisma.subjectAssignment.create({
      data: { schoolId: A.schoolId, teacherId: A.users.TEACHER.id, subjectId: s.id, classId, termId: A.termId, marksStatus: 'VERIFIED', marksVerifiedById: A.users.TEACHER.id, marksVerifiedAt: new Date() },
    });
  }

  const sat: Record<string, Record<string, number>> = {
    // sat everything, average 60
    allSubjects: { eng: 60, math: 60, sci: 60, hist: 60, art: 60, music: 60 },
    // missed the two electives and one core paper, but scored 75 in what they sat
    missedExams: { eng: 75, math: 75, sci: 75 },
    // sat a single core paper (a perfect score must not put them top)
    onePaper: { eng: 100 },
    // two students tied on 50 %
    tieOne: { eng: 50, math: 50 },
    tieTwo: { eng: 50, math: 50, sci: 50 },
    // absent for everything
    absent: {},
  };
  let n = 0;
  for (const [key, marks] of Object.entries(sat)) {
    n++;
    const st = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: `STU2026W${n}`, firstName: key, surname: 'Test', fullName: `${key} Test`, gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: classId },
    });
    students[key] = st.id;
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: st.id, classId, termId: A.termId, startDate: new Date('2026-01-10') } });
    for (const [subj, raw] of Object.entries(marks)) {
      await prisma.mark.create({
        data: { schoolId: A.schoolId, studentId: st.id, subjectId: subjects[subj], termId: A.termId, rawMark: raw, percentage: raw, status: 'VERIFIED', enteredBy: A.users.TEACHER.id },
      });
    }
  }
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

const result = (studentKey: string) => prisma.termResult.findUniqueOrThrow({ where: { studentId_termId: { studentId: students[studentKey], termId: A.termId } } });
const publish = () => call('results/publish', 'POST', { as: A.users.HEAD, body: { classId, termId: A.termId } });
const reopen = (as = A.users.HEAD, body: Record<string, unknown> = {}) =>
  call('results/unpublish', 'POST', { as, body: { classId, termId: A.termId, reason: 'Maths marks were entered under wrong names', ...body } });

describe('publishing ranks fairly', () => {
  it('publishes and reports how many students were ranked', async () => {
    const r = await publish();
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ published: 6, ranked: 4, notRanked: 2 });
  });

  it('ranks by average over the papers sat, so a missed exam is not a zero', async () => {
    const missed = await result('missedExams');
    const all = await result('allSubjects');
    expect(missed.totalMarks.toNumber()).toBe(225);
    expect(all.totalMarks.toNumber()).toBe(360); // higher total …
    expect(missed.percentage.toNumber()).toBeCloseTo(75);
    expect(all.percentage.toNumber()).toBeCloseTo(60);
    expect(missed.classPosition).toBe(1); // … but a lower average, so a lower position
    expect(all.classPosition).toBe(2);
    expect(missed.subjectsSat).toBe(3);
    expect(missed.subjectsOffered).toBe(6);
    expect(missed.rankedOutOf).toBe(4);
  });

  it('does not rank a student who sat one paper, or none', async () => {
    const one = await result('onePaper');
    expect(one.percentage.toNumber()).toBe(100);
    expect(one.classPosition).toBeNull();
    expect(one.subjectsSat).toBe(1);
    const none = await result('absent');
    expect(none.classPosition).toBeNull();
    expect(none.percentage.toNumber()).toBe(0);
    expect(none.subjectsSat).toBe(0);
  });

  it('gives students on the same average the same position and skips the next', async () => {
    const [a, b] = [await result('tieOne'), await result('tieTwo')];
    expect(a.classPosition).toBe(3);
    expect(b.classPosition).toBe(3);
  });

  it('locks the marks and marks everything published', async () => {
    const rows = await prisma.subjectAssignment.findMany({ where: { classId, termId: A.termId } });
    expect(rows.every((x) => x.marksStatus === 'PUBLISHED')).toBe(true);
    expect((await result('missedExams')).published).toBe(true);
    const edit = await call('results/marks', 'POST', {
      as: A.users.TEACHER, body: { studentId: students.onePaper, subjectId: subjects.eng, classId, termId: A.termId, rawMark: 10 },
    });
    expect(edit.status).toBe(403);
    expect(edit.json.message).toMatch(/locked/);
  });

  it('refuses to publish twice and points to the correction route', async () => {
    const r = await publish();
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/reopen/i);
  });
});

describe('correcting published results', () => {
  it('only the Head or Director may reopen, and a reason is required', async () => {
    expect((await reopen(A.users.TEACHER)).status).toBe(403);
    expect((await reopen(A.users.BURSAR)).status).toBe(403);
    expect((await reopen(A.users.HEAD, { reason: 'oops' })).status).toBe(422);
    expect((await reopen(A.users.HEAD, { reason: '' })).status).toBe(422);
  });

  it('hides the results from parents, unlocks the marks and is audited with the reason', async () => {
    const r = await reopen(A.users.DIRECTOR, { unlockMarks: true });
    expect(r.status).toBe(200);
    expect((await result('missedExams')).published).toBe(false);
    expect((await result('missedExams')).publishedAt).toBeNull();
    const assignments = await prisma.subjectAssignment.findMany({ where: { classId, termId: A.termId } });
    expect(assignments.every((x) => x.marksStatus === 'IN_PROGRESS')).toBe(true);
    const marks = await prisma.mark.findMany({ where: { termId: A.termId, subjectId: { in: Object.values(subjects) } } });
    expect(marks.every((m) => m.status === 'DRAFT')).toBe(true);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UNPUBLISH_RESULTS' }, orderBy: { createdAt: 'desc' } });
    expect(audit.actorId).toBe(A.users.DIRECTOR.id);
    expect(audit.detail).toContain('Maths marks were entered under wrong names');
  });

  it('cannot reopen what is not published', async () => {
    expect((await reopen()).status).toBe(409);
  });

  it('after the correction, republishing recalculates every position', async () => {
    // The teacher fixes the one-paper student: they did sit three core papers after all.
    for (const subject of ['math', 'sci']) {
      const edit = await call('results/marks', 'POST', {
        as: A.users.TEACHER, body: { studentId: students.onePaper, subjectId: subjects[subject], classId, termId: A.termId, rawMark: 90 },
      });
      expect(edit.status).toBe(200);
    }
    for (const a of await prisma.subjectAssignment.findMany({ where: { classId, termId: A.termId } })) {
      const v = await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: a.id, force: true } });
      expect(v.status).toBe(200);
    }
    const r = await publish();
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ published: 6, ranked: 5, notRanked: 1 });
    const fixed = await result('onePaper');
    expect(fixed.classPosition).toBe(1); // (100 + 90 + 90) / 300 = 93 %
    expect(fixed.subjectsSat).toBe(3);
    expect((await result('missedExams')).classPosition).toBe(2);
    expect((await result('allSubjects')).classPosition).toBe(3);
    expect((await result('tieOne')).classPosition).toBe(4);
    expect((await result('absent')).classPosition).toBeNull();
    expect((await result('missedExams')).published).toBe(true);
  });

  it('can reopen without unlocking the marks (they stay verified)', async () => {
    const r = await reopen(A.users.HEAD, { unlockMarks: false });
    expect(r.status).toBe(200);
    const assignments = await prisma.subjectAssignment.findMany({ where: { classId, termId: A.termId } });
    expect(assignments.every((x) => x.marksStatus === 'VERIFIED')).toBe(true);
    expect((await publish()).status).toBe(200);
  });

  it('once the term is closed the results are final', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED', closedAt: new Date() } });
    const r = await reopen();
    expect(r.status).toBe(409);
    expect(r.json.message).toMatch(/final/);
    expect((await result('missedExams')).published).toBe(true);
  });
});
