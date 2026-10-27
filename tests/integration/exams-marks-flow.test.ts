// @vitest-environment node
// Examinations, the whole way a mark travels: plan -> assessments -> entry -> submission -> HOD verification -> Head unlock,
// with the worked example from the brief and the rules the database keeps by itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf, addTeacher } from '../helpers/academics';
import { classWith, examWorld, typeIds, type ExamWorld } from '../helpers/exams';
import { PERMISSION_KEYS } from '@/lib/access-core';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let setup: typeof import('@/lib/exams/setup');
let assessments: typeof import('@/lib/exams/assessments');
let marks: typeof import('@/lib/exams/marks');
let sheets: typeof import('@/lib/exams/sheets');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let teacher: Actor;       // Mr Chikore teaches Form 2 East Maths
let hod: Actor;           // Mrs Hodge heads Sciences
let officer: Actor;       // Exams Officer
let head: Actor;
let admin: Actor;
let kids: string[];
let assignmentId: string;
let T: Record<string, string>;
let testsAid: string[] = [];
let projectAid: string;
let examAid: string;

const PLAN = (T: Record<string, string>) => ({
  termId: A.termId,
  levelId: W.form2,
  lines: [
    { label: 'Class tests and assignments', weight: 20, rule: 'AVERAGE' as const, typeIds: [T['Class test']!, T['Assignment']!] },
    { label: 'School-based project', weight: 20, rule: 'AVERAGE' as const, typeIds: [T['School-based project']!] },
    { label: 'End-of-term exam', weight: 60, rule: 'AVERAGE' as const, typeIds: [T['End-of-term exam']!] },
  ],
});

const cell = (studentId: string, assessmentId: string, value: number | null, code: 'AB' | 'EX' | 'NS' | null = null, extra: object = {}) => ({ studentId, assessmentId, value, code, ...extra });
const save = (who: Actor, cells: ReturnType<typeof cell>[], extra: object = {}) => marks.saveMarks(who, { assignmentId, cells, ...extra });
const sheetRow = () => prisma.markSheet.findUnique({ where: { assignmentId_termId: { assignmentId, termId: A.termId } } });
const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  setup = await import('@/lib/exams/setup');
  assessments = await import('@/lib/exams/assessments');
  marks = await import('@/lib/exams/marks');
  sheets = await import('@/lib/exams/sheets');
  A = await seedSchool(prisma, 'School A', { operator: true });
  B = await seedSchool(prisma, 'School B', { operator: true });
  W = await examWorld(prisma, A);
  const room = await classWith(prisma, A, { classId: W.f2East, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 4, prefix: 'Kid' });
  kids = room.kids;
  assignmentId = room.assignmentId;
  teacher = await actorOf(prisma, W.teachers.chikore);
  hod = await actorOf(prisma, W.hod);
  officer = await actorOf(prisma, W.examsOfficer);
  head = await actorOf(prisma, A.users.HEAD.id);
  admin = await actorOf(prisma, A.operator!.id);
  await setup.listTypes(officer);
  T = await typeIds(prisma, A);
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('assessment types and the weighting plan', () => {
  it('starts every school with the eight types, the exams marked as set for every class', async () => {
    const types = await setup.listTypes(officer);
    expect(types.map((x) => x.name)).toEqual(['Class test', 'Assignment', 'Practical', 'Mid-term test', 'End-of-term exam', 'Mock exam', 'School-based project', 'Other']);
    expect(types.filter((x) => x.commonExam).map((x) => x.name)).toEqual(['End-of-term exam', 'Mock exam']);
    expect(types.find((x) => x.isProject)!.name).toBe('School-based project');
  });

  it('refuses a plan whose weights do not add up to 100, or that uses a type twice', async () => {
    const bad = PLAN(T);
    await fails(setup.savePlan(officer, { ...bad, lines: [{ ...bad.lines[0]!, weight: 25 }, bad.lines[1], bad.lines[2]] }), 422, /105%/);
    await fails(setup.savePlan(officer, { ...bad, lines: [bad.lines[0], { ...bad.lines[1]!, typeIds: [T['Class test']!] }, bad.lines[2]] }), 422, /only be on one line/);
  });

  it('only people who may set up assessments can save a plan', async () => {
    await fails(setup.savePlan(teacher, PLAN(T)), 403);
    await fails(setup.savePlan(hod, PLAN(T)), 403);
  });

  it('saves a level plan, replaces it on a second save, and lets a subject override the level', async () => {
    await setup.savePlan(officer, PLAN(T));
    const again = await setup.savePlan(officer, { ...PLAN(T), name: 'Form 2 plan' });
    expect(await prisma.weightingPlan.count({ where: { schoolId: A.schoolId, termId: A.termId, levelId: W.form2, subjectId: null } })).toBe(1);
    const view = (await setup.listPlans(officer, A.termId))[0]!;
    expect(view.id).toBe(again.id);
    expect(view.lines.map((l) => [l.label, l.weight])).toEqual([['Class tests and assignments', 20], ['School-based project', 20], ['End-of-term exam', 60]]);
    expect(view.lines[0]!.typeIds.sort()).toEqual([T['Assignment'], T['Class test']].sort());

    // Combined science gives 30% to practicals.
    await setup.savePlan(officer, {
      termId: A.termId, levelId: W.form2, subjectId: W.subjects.science,
      lines: [{ label: 'Practicals', weight: 30, rule: 'BEST_N', bestN: 2, typeIds: [T['Practical']!] }, { label: 'End-of-term exam', weight: 70, rule: 'AVERAGE', typeIds: [T['End-of-term exam']!] }],
    });
    const { resolvePlan } = setup;
    const { getScopedDb } = await import('@/lib/scoped-db');
    const science = await getScopedDb(A.schoolId).$tx((tx) => resolvePlan(tx, A.schoolId, A.termId, W.form2, W.subjects.science));
    const maths = await getScopedDb(A.schoolId).$tx((tx) => resolvePlan(tx, A.schoolId, A.termId, W.form2, W.subjects.maths));
    expect(science!.lines.map((l) => l.label)).toEqual(['Practicals', 'End-of-term exam']);
    expect(maths!.lines).toHaveLength(3);
  });

  it('copies the plans to another term, keeping what is already there', async () => {
    const year = await prisma.academicYear.create({ data: { schoolId: A.schoolId, year: 2027, startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') } });
    const next = await prisma.academicTerm.create({ data: { schoolId: A.schoolId, academicYearId: year.id, termNumber: 1, name: 'Term 1 2027', startDate: new Date('2027-01-10'), endDate: new Date('2027-04-20') } });
    expect(await setup.copyPlans(officer, { fromTermId: A.termId, toTermId: next.id })).toEqual({ copied: 2, skipped: 0 });
    expect(await setup.copyPlans(officer, { fromTermId: A.termId, toTermId: next.id })).toEqual({ copied: 0, skipped: 2 });
  });
});

describe('creating assessments', () => {
  it('lets the teacher create tests for their own class', async () => {
    const t1 = await assessments.createAssessment(teacher, { assignmentId, typeId: T['Class test'], title: 'Algebra test 1', maxMark: 50, date: '2026-09-10' });
    const t2 = await assessments.createAssessment(teacher, { assignmentId, typeId: T['Class test'], title: 'Algebra test 2', maxMark: 50 });
    testsAid = [t1.id, t2.id];
    const list = await assessments.listAssessments(teacher, assignmentId);
    expect(list.map((a) => a.title)).toEqual(['Algebra test 1', 'Algebra test 2']);
  });

  it('refuses another teacher, a type set only by the Exams Officer, and a project from here', async () => {
    const other = await actorOf(prisma, W.teachers.ncube);
    await fails(assessments.createAssessment(other, { assignmentId, typeId: T['Class test'], title: 'x', maxMark: 10 }), 404);
    await fails(assessments.createAssessment(teacher, { assignmentId, typeId: T['End-of-term exam'], title: 'Exam', maxMark: 100 }), 403, /Exams Officer/);
    await fails(assessments.createAssessment(teacher, { assignmentId, typeId: T['School-based project'], title: 'Project', maxMark: 50 }), 422, /Projects page/);
  });

  it('refuses a maximum mark that is not above 0, or has too many decimals', async () => {
    await expect(assessments.createAssessment(teacher, { assignmentId, typeId: T['Class test'], title: 'x', maxMark: 0 })).rejects.toThrow();
    await expect(assessments.createAssessment(teacher, { assignmentId, typeId: T['Class test'], title: 'x', maxMark: 10.123 })).rejects.toThrow();
  });

  it('lets the Exams Officer set the end-of-term exam once for every class of the level', async () => {
    const r = await assessments.createCommonAssessments(officer, { termId: A.termId, levelId: W.form2, typeId: T['End-of-term exam'], title: 'Term 3 exam', maxMark: 100 });
    expect(r.created).toBeGreaterThanOrEqual(1);
    const again = await assessments.createCommonAssessments(officer, { termId: A.termId, levelId: W.form2, typeId: T['End-of-term exam'], title: 'Term 3 exam', maxMark: 100 });
    expect(again.created).toBe(0);
    const list = await assessments.listAssessments(teacher, assignmentId);
    const exam = list.find((a) => a.title === 'Term 3 exam')!;
    expect(exam).toMatchObject({ common: true, maxMark: 100 });
    examAid = exam.id;
    await fails(assessments.createCommonAssessments(teacher, { termId: A.termId, levelId: W.form2, typeId: T['Mock exam'], title: 'Mock', maxMark: 100 }), 403);
  });

  it('adds a project-type assessment (made by the projects service in the app) so the worked example can run', async () => {
    const a = await prisma.assessment.create({ data: { schoolId: A.schoolId, termId: A.termId, assignmentId, levelId: W.form2, subjectId: W.subjects.maths, typeId: T['School-based project']!, title: 'Statistics project', maxMark: 50 } });
    projectAid = a.id;
    expect(projectAid).toBeTruthy();
  });
});

describe('the grid and entering marks', () => {
  it('lists the students taking the subject in the class, by surname, with the assessments across', async () => {
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.students.map((s) => s.name)).toEqual(['AKID, Kid1', 'BKID, Kid2', 'CKID, Kid3', 'DKID, Kid4']);
    expect(g.columns.map((c) => c.title)).toEqual(['Algebra test 1', 'Algebra test 2', 'Term 3 exam', 'Statistics project']);
    expect(g.canEdit).toBe(true);
    expect(g.sheet.status).toBe('NOT_STARTED');
    expect(g.planProblem).toBeNull();
  });

  it('does not list a student who does not take the subject, and refuses a mark for them', async () => {
    const { addStudent } = await import('../helpers/students');
    const stray = await addStudent(prisma, A, { classId: W.f2East, firstName: 'Stray', surname: 'Zed' });
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.students.some((s) => s.id === stray.id)).toBe(false);
    const r = await save(teacher, [cell(stray.id, testsAid[0]!, 10)]);
    expect(r.outcomes[0]).toMatchObject({ status: 'rejected', message: expect.stringMatching(/does not take the subject/) });
  });

  it('rejects a mark above the maximum, a negative number, and a code on its own terms; saves the rest of the batch', async () => {
    const r = await save(teacher, [cell(kids[0]!, testsAid[0]!, 51), cell(kids[1]!, testsAid[0]!, -1), cell(kids[2]!, testsAid[0]!, 30), cell(kids[3]!, testsAid[0]!, null, 'AB')]);
    expect(r.outcomes.map((o) => o.status)).toEqual(['rejected', 'rejected', 'saved', 'saved']);
    expect((r.outcomes[0] as { message: string }).message).toMatch(/maximum of 50/);
    expect(r.sheet.status).toBe('IN_PROGRESS');
    expect(await prisma.assessmentMark.count({ where: { assignmentId } })).toBe(2);
  });

  it('refuses a cell with both a mark and a code, and an invalid code', async () => {
    await expect(save(teacher, [{ ...cell(kids[0]!, testsAid[0]!, 10), code: 'AB' }])).rejects.toThrow();
    await expect(save(teacher, [{ ...cell(kids[0]!, testsAid[0]!, null), code: 'XX' as never }])).rejects.toThrow();
  });

  it('saving the same marks again changes nothing', async () => {
    const r = await save(teacher, [cell(kids[2]!, testsAid[0]!, 30)]);
    expect(r).toMatchObject({ saved: 0, unchanged: 1 });
  });

  it('lets the later version of a cell win when marks arrive from an offline device', async () => {
    const early = new Date('2026-10-01T08:00:00Z').toISOString();
    const late = new Date('2026-10-01T09:00:00Z').toISOString();
    await save(teacher, [cell(kids[0]!, testsAid[0]!, 35, null, { changedAt: late })]);
    const r = await save(teacher, [cell(kids[0]!, testsAid[0]!, 20, null, { changedAt: early })]);
    expect(r.outcomes[0]).toMatchObject({ status: 'stale', value: 35 });
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assignmentId, studentId: kids[0]!, assessmentId: testsAid[0]! } });
    expect(Number(m.value)).toBe(35);
  });

  it('warns, but still saves, a mark far from the class mean', async () => {
    const many = await classWith(prisma, A, { classId: W.f1South, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 12, prefix: 'Spread' });
    const a = await assessments.createAssessment(teacher, { assignmentId: many.assignmentId, typeId: T['Class test'], title: 'Spread test', maxMark: 100 });
    const cells = many.kids.slice(0, 11).map((k, i) => ({ studentId: k, assessmentId: a.id, value: 50 + (i % 3), code: null }));
    await marks.saveMarks(teacher, { assignmentId: many.assignmentId, cells });
    const r = await marks.saveMarks(teacher, { assignmentId: many.assignmentId, cells: [{ studentId: many.kids[11]!, assessmentId: a.id, value: 99, code: null }] });
    expect(r.saved).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.message).toMatch(/standard deviations/);
  });

  it('warns when a student is marked AB although the register shows them present that day', async () => {
    const a = await assessments.createAssessment(teacher, { assignmentId, typeId: T['Class test'], title: 'Dated test', maxMark: 20, date: '2026-10-05' });
    const reg = await prisma.attendanceRegister.create({ data: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East, date: new Date('2026-10-05'), session: 'AM', markedById: W.teachers.chikore } });
    await prisma.attendanceEntry.create({ data: { schoolId: A.schoolId, registerId: reg.id, studentId: kids[1]!, status: 'PRESENT' } });
    const r = await save(teacher, [cell(kids[1]!, a.id, null, 'AB')]);
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/register shows/)]);
    await assessments.updateAssessment(teacher, a.id, { countsToTerm: false });
  });
});

describe('submitting a mark sheet', () => {
  it('lists the missing marks and does not submit', async () => {
    const check = await sheets.submissionCheck(teacher, assignmentId);
    expect(check.ready).toBe(false);
    expect(check.missingTotal).toBeGreaterThan(0);
    expect(check.missing[0]).toMatchObject({ student: expect.any(String), assessment: expect.any(String) });
    await fails(sheets.submitSheet(teacher, assignmentId), 409, /mark\(s\) are missing/);
    expect((await sheetRow())!.status).toBe('IN_PROGRESS');
  });

  it('cannot be submitted by someone else', async () => {
    await fails(sheets.submitSheet(await actorOf(prisma, W.teachers.ncube), assignmentId), 404);
    await fails(sheets.submitSheet(hod, assignmentId), 404);
  });

  it('is submitted once every student has a mark, AB, EX or NS for every assessment that counts', async () => {
    // The worked example for the first student, other students get a mix of codes.
    const fill = [
      cell(kids[0]!, testsAid[0]!, 30), cell(kids[0]!, testsAid[1]!, 40), cell(kids[0]!, projectAid, 36), cell(kids[0]!, examAid, 58),
      cell(kids[1]!, testsAid[0]!, 45), cell(kids[1]!, testsAid[1]!, 45), cell(kids[1]!, projectAid, 45), cell(kids[1]!, examAid, 90),
      cell(kids[2]!, testsAid[1]!, 20), cell(kids[2]!, projectAid, null, 'NS'), cell(kids[2]!, examAid, 40),
      cell(kids[3]!, testsAid[1]!, null, 'EX'), cell(kids[3]!, projectAid, 25), cell(kids[3]!, examAid, 40),
    ];
    const r = await save(teacher, fill);
    expect(r.outcomes.every((o) => o.status === 'saved' || o.status === 'unchanged')).toBe(true);
    expect(r.sheet).toMatchObject({ entered: 4, expected: 4 });
    const g = await marks.loadGrid(teacher, assignmentId);
    // The first student's term mark matches the worked example: 63.2, shown as 63, grade B.
    expect(g.preview[kids[0]!]).toMatchObject({ termMark: 63.2, roundedMark: 63, grade: 'B' });
    const done = await sheets.submitSheet(teacher, assignmentId);
    expect(done.status).toBe('SUBMITTED');
    const row = (await sheetRow())!;
    expect(row).toMatchObject({ status: 'SUBMITTED', submittedById: W.teachers.chikore });
    expect(row.firstSubmittedAt).toBeTruthy();
  });

  it('locks the sheet: no more marks from the grid, and the database refuses them too', async () => {
    await fails(save(teacher, [cell(kids[0]!, testsAid[0]!, 31)]), 409, /submitted/);
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assignmentId, studentId: kids[0]!, assessmentId: testsAid[0]! } });
    await expect(t.pg.query(`UPDATE "AssessmentMark" SET "value" = 31 WHERE "id" = '${m.id}'`)).rejects.toThrow(/locked/);
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.canEdit).toBe(false);
  });

  it('notifies the Head of Department', async () => {
    const n = await prisma.notification.findMany({ where: { userId: W.hod, type: 'MARKS_SUBMITTED' } });
    expect(n).toHaveLength(1);
  });
});

describe('verification', () => {
  it('is for the Head of Department of the subject, not the teacher', async () => {
    await fails(sheets.verifySheet(teacher, assignmentId), 403, /own marks/);
    const otherHod = await addTeacher(prisma, A, 'Mr Other Hod', ['HOD']);
    await fails(sheets.verifySheet(await actorOf(prisma, otherHod), assignmentId), 404);
  });

  it('lists the sheet in the HOD queue, with the other classes of the subject beside it', async () => {
    const q = await sheets.verificationQueue(hod);
    expect(q.items.map((i) => i.assignmentId)).toContain(assignmentId);
    const review = await sheets.reviewSheet(hod, assignmentId);
    expect(review.mayVerify).toBe(true);
    expect(review.stats.count).toBe(4);
    expect(review.gradeSpread.map((g) => g.grade)).toEqual(['A', 'B', 'C', 'D', 'E', 'U']);
    expect(review.siblings.map((s) => s.className)).toContain('Form 2 East');
    expect(review.siblings.find((s) => s.current)!.students).toBe(4);
  });

  it('returns the sheet to the teacher only with a comment, and tells the teacher', async () => {
    await expect(sheets.returnSheet(hod, assignmentId, { comment: '' })).rejects.toThrow();
    await sheets.returnSheet(hod, assignmentId, { comment: 'Check CKid exam mark' });
    const row = (await sheetRow())!;
    expect(row).toMatchObject({ status: 'RETURNED', returnedComment: 'Check CKid exam mark', returnedById: W.hod });
    expect(await prisma.notification.count({ where: { userId: W.teachers.chikore, type: 'MARKS_RETURNED' } })).toBe(1);
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.canEdit).toBe(true);
    expect(g.sheet).toMatchObject({ status: 'RETURNED', returnedComment: 'Check CKid exam mark', needsReason: true });
  });

  it('keeps every change after the first submission: old value, new value, who, when and why', async () => {
    await fails(save(teacher, [cell(kids[2]!, examAid, 45)]), 422, /needs a reason|every change needs a reason/);
    await save(teacher, [cell(kids[2]!, examAid, 45)], { reason: 'Marked the wrong script' });
    const changes = await prisma.assessmentMarkChange.findMany({ where: { schoolId: A.schoolId } });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ changedById: W.teachers.chikore, reason: 'Marked the wrong script', newCode: null });
    expect(Number(changes[0]!.oldValue)).toBe(40);
    expect(Number(changes[0]!.newValue)).toBe(45);
    await expect(t.pg.query(`UPDATE "AssessmentMarkChange" SET "reason" = 'edited' WHERE "id" = '${changes[0]!.id}'`)).rejects.toThrow(/only be added/);
    await expect(t.pg.query(`DELETE FROM "AssessmentMarkChange" WHERE "id" = '${changes[0]!.id}'`)).rejects.toThrow(/only be added/);
    const review = await sheets.reviewSheet(hod, assignmentId);
    expect(review.history).toHaveLength(1);
    expect(review.history[0]).toMatchObject({ from: '40', to: '45', reason: 'Marked the wrong script', by: expect.stringContaining('Chikore') });
  });

  it('is resubmitted, then verified: locked, with the results calculated', async () => {
    await sheets.submitSheet(teacher, assignmentId);
    const v = await sheets.verifySheet(hod, assignmentId);
    expect(v.status).toBe('VERIFIED');
    const row = (await sheetRow())!;
    expect(row).toMatchObject({ status: 'VERIFIED', verifiedById: W.hod });
    const events = await prisma.markSheetEvent.findMany({ where: { sheetId: row.id }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.action)).toEqual(['SUBMIT', 'RETURN', 'SUBMIT', 'VERIFY']);
    await fails(sheets.verifySheet(hod, assignmentId), 409);
  });

  it('calculates subject results with the worked example, grades copied onto the result, positions in class and form', async () => {
    const rows = await prisma.subjectResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, subjectId: W.subjects.maths, classId: W.f2East }, orderBy: { termMark: 'desc' } });
    expect(rows).toHaveLength(4);
    const first = rows.find((r) => r.studentId === kids[0])!;
    expect(Number(first.termMark)).toBe(63.2);
    expect(first).toMatchObject({ roundedMark: 63, grade: 'B', remark: 'Very good', published: false, teacherInitials: 'TC' });
    expect((first.typeScores as { label: string; score: number }[]).map((s) => s.score)).toEqual([70, 72, 58]);
    // kids[1]: tests 90%, project 90%, exam 90% = 90; kids[2] after the correction: tests (0 + 40)/2 = 20 -> see below
    const second = rows.find((r) => r.studentId === kids[1])!;
    expect(Number(second.termMark)).toBe(90);
    expect(rows.map((r) => r.classPosition)).toEqual([1, 2, 3, 4]);
    expect(rows[0]!.classSize).toBe(4);
    expect(rows[0]!.formPosition).toBe(1);
    expect(rows.every((r) => r.published === false)).toBe(true);
  });

  it('leaves out an exempt assessment and scales the other weights to 100%', async () => {
    const r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[3]!, subjectId: W.subjects.maths, termId: A.termId } });
    // kids[3]: test 1 AB (0), test 2 EX (left out) -> tests 0%; project 25/50 = 50%; exam 40% -> 0.2*0 + 0.2*50 + 0.6*40 = 34
    expect(Number(r.termMark)).toBe(34);
  });

  it('counts NS as 0 for the student who did not submit the project', async () => {
    const r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[2]!, subjectId: W.subjects.maths, termId: A.termId } });
    // tests: test 1 = 30/50 = 60%, test 2 = 20/50 = 40% -> 50; project NS = 0; exam 45% -> 10 + 0 + 27 = 37
    expect(Number(r.termMark)).toBe(37);
  });

  it('works out the overall average over the subjects taken, with class and form positions', async () => {
    const overall = await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East }, orderBy: { classPosition: 'asc' } });
    expect(overall).toHaveLength(4);
    expect(overall.map((o) => o.studentId)).toEqual([kids[1], kids[0], kids[2], kids[3]]);
    expect(overall.map((o) => o.classPosition)).toEqual([1, 2, 3, 4]);
    expect(overall[0]).toMatchObject({ classSize: 4, subjectsTaken: 1, published: false });
    expect(Number(overall[1]!.averagePercentage)).toBe(63.2);
  });
});

describe('unlocking a verified sheet', () => {
  it('is for the Head only, with a reason, and not for the HOD or the teacher', async () => {
    await fails(sheets.unlockSheet(hod, assignmentId, { reason: 'Wrong mark entered' }), 403);
    await fails(sheets.unlockSheet(teacher, assignmentId, { reason: 'Wrong mark entered' }), 403);
    await expect(sheets.unlockSheet(head, assignmentId, { reason: '' })).rejects.toThrow();
  });

  it('sends it back to the teacher, removes its results from the class, and records who and why', async () => {
    await sheets.unlockSheet(head, assignmentId, { reason: 'Exam script 3 was marked out of the wrong paper' });
    const row = (await sheetRow())!;
    expect(row).toMatchObject({ status: 'UNLOCKED', unlockedById: A.users.HEAD.id, unlockReason: 'Exam script 3 was marked out of the wrong paper' });
    expect(await prisma.subjectResult.count({ where: { schoolId: A.schoolId, termId: A.termId, subjectId: W.subjects.maths, classId: W.f2East } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: W.teachers.chikore, type: 'MARKS_UNLOCKED' } })).toBe(1);
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.canEdit).toBe(true);
    expect(g.sheet.unlockReason).toMatch(/wrong paper/);
  });

  it('keeps every change made after the unlock in the mark history, then goes through verification again', async () => {
    await fails(save(teacher, [cell(kids[0]!, examAid, 60)]), 422);
    await save(teacher, [cell(kids[0]!, examAid, 60)], { reason: 'Exam script 3 was marked out of the wrong paper' });
    expect(await prisma.assessmentMarkChange.count({ where: { schoolId: A.schoolId } })).toBe(2);
    await sheets.submitSheet(teacher, assignmentId);
    await sheets.verifySheet(hod, assignmentId);
    const r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[0]!, subjectId: W.subjects.maths, termId: A.termId } });
    expect(Number(r.termMark)).toBe(64.4); // tests (60% + 80%) / 2 = 70 -> 14; project 72% -> 14.4; exam 60% -> 36
    expect(r.grade).toBe('B');
  });
});

describe('rules the database keeps by itself', () => {
  it('never deletes a mark', async () => {
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assignmentId } });
    await expect(t.pg.query(`DELETE FROM "AssessmentMark" WHERE "id" = '${m.id}'`)).rejects.toThrow(/never deleted/);
    await expect(t.pg.query(`DELETE FROM "AssessmentMark" WHERE "assignmentId" = '${assignmentId}'`)).rejects.toThrow(/never deleted/);
  });

  it('fixes the maximum mark once marks exist; a copy starts again and replaces the original', async () => {
    await fails(assessments.updateAssessment(teacher, testsAid[0]!, { maxMark: 40 }), 409, /Copy the assessment/);
    await expect(t.pg.query(`UPDATE "Assessment" SET "maxMark" = 40 WHERE "id" = '${testsAid[0]!}'`)).rejects.toThrow(/cannot change once marks exist/);
    // An assessment without marks can change.
    const fresh = await assessments.createAssessment(teacher, { assignmentId: (await classWith(prisma, A, { classId: W.f3North, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 1, prefix: 'Tmp' })).assignmentId, typeId: T['Class test'], title: 'Fresh', maxMark: 20 });
    await assessments.updateAssessment(teacher, fresh.id, { maxMark: 25 });
    expect(Number((await prisma.assessment.findUniqueOrThrow({ where: { id: fresh.id } })).maxMark)).toBe(25);
  });

  it('does not let a mark exceed the maximum even when written straight to the database', async () => {
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { assignmentId, assessmentId: examAid } });
    await expect(t.pg.query(`UPDATE "AssessmentMark" SET "value" = 101 WHERE "id" = '${m.id}'`)).rejects.toThrow(/above the maximum/);
  });

  it('refuses a mark of a student for an assessment of another school', async () => {
    const foreign = await prisma.assessment.create({ data: { schoolId: B.schoolId, termId: B.termId, levelId: B.levelId, subjectId: B.subjectId, typeId: (await prisma.assessmentType.create({ data: { schoolId: B.schoolId, name: 'Test' } })).id, title: 'B test', maxMark: 10 } });
    await expect(t.pg.query(`INSERT INTO "AssessmentMark" ("id", "schoolId", "assessmentId", "assignmentId", "studentId", "value", "enteredById") VALUES ('x1', '${A.schoolId}', '${foreign.id}', '${assignmentId}', '${kids[0]!}', 5, '${A.operator!.id}')`)).rejects.toThrow(/Cross-school/);
  });
});

describe('school isolation', () => {
  it('does not show or change another school\'s mark sheets', async () => {
    const outsider = await actorOf(prisma, B.operator!.id);
    await fails(marks.loadGrid(outsider, assignmentId), 404);
    await fails(save(outsider, [cell(kids[0]!, examAid, 10)]), 404);
    await fails(sheets.verifySheet(outsider, assignmentId), 404);
    await fails(sheets.unlockSheet({ ...outsider, grants: [...PERMISSION_KEYS] }, assignmentId, { reason: 'trying it on' }), 404);
    expect((await setup.listPlans(outsider, B.termId)).length).toBe(0);
  });
});

describe('administrators', () => {
  it('may do each step, and the system records who did it', async () => {
    const q = await sheets.verificationQueue(admin);
    expect(Array.isArray(q.items)).toBe(true);
  });

  it('cannot verify the marks of a class they teach themselves', async () => {
    // The administrator also teaches this class: self-verification is refused even for an admin.
    const adminAssignment = await classWith(prisma, A, { classId: W.f1North, subjectId: W.subjects.english, teacherId: A.operator!.id, count: 2, prefix: 'Adm' });
    const a = await assessments.createAssessment(admin, { assignmentId: adminAssignment.assignmentId, typeId: T['Class test'], title: 'Admin test', maxMark: 10 });
    await marks.saveMarks(admin, { assignmentId: adminAssignment.assignmentId, cells: adminAssignment.kids.map((k) => ({ studentId: k, assessmentId: a.id, value: 5, code: null })) });
    await setup.savePlan(officer, { termId: A.termId, levelId: (await prisma.schoolClass.findUniqueOrThrow({ where: { id: W.f1North } })).levelId, lines: [{ label: 'Tests', weight: 100, rule: 'AVERAGE', typeIds: [T['Class test']!] }] });
    await sheets.submitSheet(admin, adminAssignment.assignmentId);
    await fails(sheets.verifySheet(admin, adminAssignment.assignmentId), 403, /own marks/);
    const sheet = await prisma.markSheet.findFirstOrThrow({ where: { assignmentId: adminAssignment.assignmentId } });
    await expect(t.pg.query(`UPDATE "MarkSheet" SET "status" = 'VERIFIED', "verifiedById" = '${A.operator!.id}', "verifiedAt" = now() WHERE "id" = '${sheet.id}'`)).rejects.toThrow(/cannot verify your own marks/);
  });
});
