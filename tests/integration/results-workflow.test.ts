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

  // Every student has a row for every subject: a score, ABSENT or EXEMPT.
  const ALL = ['eng', 'math', 'sci', 'hist', 'art', 'music'];
  type Cell = number | 'ABSENT' | 'EXEMPT';
  const rows: Record<string, Record<string, Cell>> = {
    // sat everything, average 60
    allSubjects: { eng: 60, math: 60, sci: 60, hist: 60, art: 60, music: 60 },
    // takes different subjects: exempt from history and both electives, 75 in the rest
    missedExams: { eng: 75, math: 75, sci: 75, hist: 'EXEMPT', art: 'EXEMPT', music: 'EXEMPT' },
    // counts for only one core subject: a perfect score must not put them top
    onePaper: { eng: 100, math: 'EXEMPT', sci: 'EXEMPT', hist: 'EXEMPT', art: 'EXEMPT', music: 'EXEMPT' },
    // two students on the same 50 % average
    tieOne: { eng: 50, math: 50, sci: 'EXEMPT', hist: 'EXEMPT', art: 'EXEMPT', music: 'EXEMPT' },
    tieTwo: { eng: 50, math: 50, sci: 50, hist: 'EXEMPT', art: 'EXEMPT', music: 'EXEMPT' },
    // absent for everything: counts as 0 % but is still ranked (last)
    absent: Object.fromEntries(ALL.map((k) => [k, 'ABSENT' as Cell])),
  };
  let n = 0;
  for (const [key, cells] of Object.entries(rows)) {
    n++;
    const st = await prisma.student.create({
      data: { schoolId: A.schoolId, admissionNumber: `STU2026W${n}`, firstName: key, surname: 'Test', fullName: `${key} Test`, gender: 'M', admissionDate: new Date('2026-01-10'), currentClassId: classId },
    });
    students[key] = st.id;
    await prisma.enrollment.create({ data: { schoolId: A.schoolId, studentId: st.id, classId, termId: A.termId, startDate: new Date('2026-01-10') } });
    for (const subj of ALL) {
      const cell = cells[subj];
      const scored = typeof cell === 'number';
      await prisma.mark.create({
        data: {
          schoolId: A.schoolId, studentId: st.id, subjectId: subjects[subj], termId: A.termId,
          rawMark: scored ? cell : 0, percentage: scored ? cell : null,
          status: scored ? 'VERIFIED' : cell, firstVerifiedAt: new Date(), enteredBy: A.users.TEACHER.id,
        },
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
    expect(r.json.data).toMatchObject({ published: 6, ranked: 5, notRanked: 1 });
  });

  it('ranks by the average over the subjects that count, so different subjects are not penalised', async () => {
    const other = await result('missedExams');
    const all = await result('allSubjects');
    expect(other.totalMarks.toNumber()).toBe(225);
    expect(all.totalMarks.toNumber()).toBe(360); // higher total …
    expect(other.averagePercentage?.toNumber()).toBeCloseTo(75);
    expect(all.averagePercentage?.toNumber()).toBeCloseTo(60);
    expect(other.percentage.toNumber()).toBeCloseTo(75); // older column kept in step
    expect(other.classPosition).toBe(1); // … but a lower average, so a lower position
    expect(all.classPosition).toBe(2);
    expect(other.subjectsTaken).toBe(3); // exempt subjects are not counted
    expect(other.subjectsOffered).toBe(6);
    expect(other.rankedOutOf).toBe(5);
    expect(all.subjectsTaken).toBe(6);
  });

  it('counts subjects passed (default pass grade: the boundary of C, else 50 %)', async () => {
    expect((await result('allSubjects')).subjectsPassed).toBe(6);
    expect((await result('missedExams')).subjectsPassed).toBe(3);
    expect((await result('tieOne')).subjectsPassed).toBe(2);
    expect((await result('absent')).subjectsPassed).toBe(0);
  });

  it('does not rank a student for whom only one core subject counts', async () => {
    const one = await result('onePaper');
    expect(one.averagePercentage?.toNumber()).toBe(100);
    expect(one.classPosition).toBeNull();
    expect(one.subjectsTaken).toBe(1);
  });

  it('an absent student counts as 0 % and is ranked last', async () => {
    const none = await result('absent');
    expect(none.averagePercentage?.toNumber()).toBe(0);
    expect(none.subjectsTaken).toBe(6);
    expect(none.classPosition).toBe(5);
  });

  it('gives students on the same average the same position and skips the next', async () => {
    expect((await result('tieOne')).classPosition).toBe(3);
    expect((await result('tieTwo')).classPosition).toBe(3);
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

describe('correcting published results (4.1)', () => {
  it('only the HEAD may unpublish, and a reason is required', async () => {
    expect((await reopen(A.users.TEACHER)).status).toBe(403);
    expect((await reopen(A.users.DIRECTOR)).status).toBe(403);
    expect((await reopen(A.users.BURSAR)).status).toBe(403);
    expect((await reopen(A.users.HEAD, { reason: 'oops' })).status).toBe(422);
    expect((await reopen(A.users.HEAD, { reason: '' })).status).toBe(422);
  });

  it('unpublishes the class: off the portal, every subject back to VERIFIED, audited with the reason', async () => {
    const r = await reopen(A.users.HEAD);
    expect(r.status).toBe(200);
    expect((await result('missedExams')).published).toBe(false);
    expect((await result('missedExams')).publishedAt).toBeNull();
    const assignments = await prisma.subjectAssignment.findMany({ where: { classId, termId: A.termId } });
    expect(assignments.every((x) => x.marksStatus === 'VERIFIED')).toBe(true);
    const marks = await prisma.mark.findMany({ where: { termId: A.termId, subjectId: { in: Object.values(subjects) } } });
    expect(marks.some((m) => m.status === 'PUBLISHED')).toBe(false); // scores back to VERIFIED; absences and exemptions stay as entered
    expect(marks.filter((m) => m.status === 'VERIFIED').length).toBeGreaterThan(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UNPUBLISH_RESULTS' }, orderBy: { createdAt: 'desc' } });
    expect(audit.actorId).toBe(A.users.HEAD.id);
    expect(audit.detail).toContain('Maths marks were entered under wrong names');
  });

  it('cannot unpublish what is not published', async () => {
    expect((await reopen()).status).toBe(409);
  });

  it('marks stay locked until the Head unlocks the one subject to fix', async () => {
    const math = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: subjects.math, termId: A.termId } });
    const edit = await call('results/marks', 'POST', {
      as: A.users.TEACHER, body: { studentId: students.onePaper, subjectId: subjects.math, classId, termId: A.termId, rawMark: 90, reason: 'Recount' },
    });
    expect(edit.status).toBe(403);
    expect((await call('results/marks/unverify', 'POST', { as: A.users.TEACHER, body: { assignmentId: math.id } })).status).toBe(403);
  });

  it('a change to a verified mark needs a reason, and is recorded in MarkChange', async () => {
    const math = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: subjects.math, termId: A.termId } });
    const sci = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: subjects.sci, termId: A.termId } });
    expect((await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: math.id } })).status).toBe(200);
    expect((await prisma.subjectAssignment.findUniqueOrThrow({ where: { id: sci.id } })).marksStatus).toBe('VERIFIED'); // others untouched

    const body = { studentId: students.missedExams, subjectId: subjects.math, classId, termId: A.termId, rawMark: 90 };
    const noReason = await call('results/marks', 'POST', { as: A.users.TEACHER, body });
    expect(noReason.status).toBe(422);
    expect(noReason.json.message).toMatch(/reason is required/);
    expect((await call('results/marks', 'POST', { as: A.users.TEACHER, body: { ...body, reason: 'x' } })).status).toBe(422);
    expect(await prisma.markChange.count()).toBe(0);

    // Replacing an absence with a score is also a change to a verified row.
    const absentToScore = await call('results/marks', 'POST', { as: A.users.TEACHER, body: { ...body, studentId: students.absent, rawMark: 40 } });
    expect(absentToScore.status).toBe(422);
    expect(await prisma.markChange.count()).toBe(0);

    const ok = await call('results/marks', 'POST', { as: A.users.TEACHER, body: { ...body, reason: 'Paper was marked out of the wrong total' } });
    expect(ok.status).toBe(200);
    const [change] = await prisma.markChange.findMany();
    expect(change).toMatchObject({ changedById: A.users.TEACHER.id, reason: 'Paper was marked out of the wrong total', schoolId: A.schoolId });
    expect(change.oldRawMark.toNumber()).toBe(75);
    expect(change.newRawMark.toNumber()).toBe(90);
    expect(await prisma.auditLog.count({ where: { action: 'CHANGE_MARK', entityId: change.markId } })).toBe(1);

    // Sending the same value again is not a change.
    expect((await call('results/marks', 'POST', { as: A.users.TEACHER, body })).status).toBe(200);
    expect(await prisma.markChange.count()).toBe(1);
  });

  it('the history cannot be edited or deleted', async () => {
    await expect(t.pg.exec('DELETE FROM "MarkChange"')).rejects.toThrow(/cannot be changed or deleted/); // straight to Postgres: the test socket drops after a DB error
  });

  it('after the correction, republishing recalculates every position', async () => {
    const math = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, subjectId: subjects.math, termId: A.termId } });
    expect((await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: math.id, force: true } })).status).toBe(200);
    const r = await publish();
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ published: 6 });
    const fixed = await result('missedExams');
    expect(fixed.published).toBe(true);
    expect(fixed.totalMarks.toNumber()).toBe(240); // 90 + 75 + 75
    expect(fixed.averagePercentage?.toNumber()).toBeCloseTo(80);
    expect(fixed.classPosition).toBe(1);
    expect((await result('allSubjects')).classPosition).toBe(2);
  });
});

describe('a CLOSED term is locked (4.1)', () => {
  it('blocks marks, verify, unverify, publish and unpublish', async () => {
    await prisma.academicTerm.update({ where: { id: A.termId }, data: { status: 'CLOSED', closedAt: new Date() } });
    const a = await prisma.subjectAssignment.findFirstOrThrow({ where: { classId, termId: A.termId } });
    expect((await reopen()).status).toBe(409);
    expect((await call('results/marks/unverify', 'POST', { as: A.users.HEAD, body: { assignmentId: a.id } })).status).toBe(409);
    expect((await call('results/marks/verify', 'POST', { as: A.users.TEACHER, body: { assignmentId: a.id, force: true } })).status).toBe(409);
    expect((await publish()).status).toBe(409);
    const edit = await call('results/marks', 'POST', {
      as: A.users.TEACHER, body: { studentId: students.onePaper, subjectId: subjects.math, classId, termId: A.termId, rawMark: 1, reason: 'Trying to change a closed term' },
    });
    expect(edit.status).toBe(409);
    expect((await result('missedExams')).published).toBe(true);
  });

  it('only the Director can reopen it, with a reason', async () => {
    const path = 'director/terms/[id]/reopen';
    const params = { id: A.termId };
    for (const role of ['HEAD', 'ADMIN', 'BURSAR', 'TEACHER'] as const) {
      expect((await call(path, 'POST', { as: A.users[role], params, body: { reason: 'Needed to fix a marking error' } })).status).toBe(403);
    }
    expect((await call(path, 'POST', { as: A.users.DIRECTOR, params, body: { reason: 'short' } })).status).toBe(422);
    const ok = await call(path, 'POST', { as: A.users.DIRECTOR, params, body: { reason: 'Needed to fix a marking error' } });
    expect(ok.status).toBe(200);
    const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: A.termId } });
    expect(term.status).toBe('OPEN');
    expect(term.closedAt).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'REOPEN_TERM' } });
    expect(audit.actorId).toBe(A.users.DIRECTOR.id);
    expect(audit.detail).toContain('Needed to fix a marking error');
    expect((await reopen()).status).toBe(200); // the Head can correct again
  });

  it('cannot reopen a term that is not closed', async () => {
    const r = await call('director/terms/[id]/reopen', 'POST', { as: A.users.DIRECTOR, params: { id: A.termId }, body: { reason: 'Already open, nothing to do' } });
    expect(r.status).toBe(409);
  });
});
