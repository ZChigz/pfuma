// @vitest-environment node
// Comments, the pre-publish check, publishing, unpublishing and republishing, report cards and their verification codes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { classWith, examWorld, takeSubject, typeIds, type ExamWorld } from '../helpers/exams';

let t: TestDb;
let A: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let setup: typeof import('@/lib/exams/setup');
let assessments: typeof import('@/lib/exams/assessments');
let marks: typeof import('@/lib/exams/marks');
let sheets: typeof import('@/lib/exams/sheets');
let publish: typeof import('@/lib/exams/publish');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let mathsTeacher: Actor; let englishTeacher: Actor; let hod: Actor; let head: Actor; let admin: Actor; let officer: Actor;
let kids: string[];
let mathsA: string; let englishA: string;
let T: Record<string, string>;
let exam: Record<string, string> = {};

const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

/** Enters an exam mark for each student under the assignment (the plan is tests 40% / exam 60%). */
async function enter(who: Actor, assignmentId: string, assessmentId: string, values: number[], reason?: string) {
  return marks.saveMarks(who, { assignmentId, reason, cells: kids.map((studentId, i) => ({ studentId, assessmentId, value: values[i]!, code: null })) });
}

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  setup = await import('@/lib/exams/setup');
  assessments = await import('@/lib/exams/assessments');
  marks = await import('@/lib/exams/marks');
  sheets = await import('@/lib/exams/sheets');
  publish = await import('@/lib/exams/publish');
  A = await seedSchool(prisma, 'School A', { operator: true });
  W = await examWorld(prisma, A);
  const maths = await classWith(prisma, A, { classId: W.f2East, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 4, prefix: 'Kid' });
  kids = maths.kids;
  mathsA = maths.assignmentId;
  await takeSubject(prisma, A, kids, W.subjects.english);
  englishA = (await prisma.teacherAssignment.create({ data: { schoolId: A.schoolId, termId: A.termId, teacherId: W.teachers.moyo, subjectId: W.subjects.english, classId: W.f2East, startDate: new Date('2026-09-01') } })).id;
  await prisma.classTeacher.create({ data: { schoolId: A.schoolId, classId: W.f2East, termId: A.termId, userId: W.teachers.moyo } });
  // Being made class teacher gives the CLASS_TEACHER role for that class (Academics does this when it assigns one).
  const ctRole = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: A.schoolId, key: 'CLASS_TEACHER' } });
  await prisma.userRole.create({ data: { schoolId: A.schoolId, userId: W.teachers.moyo, roleId: ctRole.id, scopeType: 'CLASS', scopeId: W.f2East } });
  mathsTeacher = await actorOf(prisma, W.teachers.chikore);
  englishTeacher = await actorOf(prisma, W.teachers.moyo);
  hod = await actorOf(prisma, W.hod);
  head = await actorOf(prisma, A.users.HEAD.id);
  admin = await actorOf(prisma, A.operator!.id);
  officer = await actorOf(prisma, W.examsOfficer);
  await setup.listTypes(officer);
  T = await typeIds(prisma, A);
  await setup.savePlan(officer, { termId: A.termId, levelId: W.form2, lines: [
    { label: 'Class tests', weight: 40, rule: 'AVERAGE', typeIds: [T['Class test']!] },
    { label: 'End-of-term exam', weight: 60, rule: 'AVERAGE', typeIds: [T['End-of-term exam']!] },
  ] });
  await assessments.createCommonAssessments(officer, { termId: A.termId, levelId: W.form2, typeId: T['End-of-term exam'], title: 'Term exam', maxMark: 100 });
  for (const [name, id] of [['maths', mathsA], ['english', englishA]] as const) {
    const list = await assessments.listAssessments(admin, id);
    exam[name] = list.find((x) => x.title === 'Term exam')!.id;
  }
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('the pre-publish check', () => {
  it('lists unverified sheets, missing class teacher comments and missing Head remarks', async () => {
    const c = await publish.prePublishCheck(head, W.f2East);
    expect(c.ready).toBe(false);
    const kinds = c.problems.map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(['SHEET', 'CLASS_COMMENT', 'HEAD_REMARK']));
    expect(c.problems.find((p) => p.kind === 'SHEET')!.items).toHaveLength(2);
    expect(c.problems.find((p) => p.kind === 'CLASS_COMMENT')!.items).toHaveLength(4);
  });

  it('refuses to publish while anything is missing, naming it', async () => {
    await fails(publish.publishClasses(head, { classIds: [W.f2East] }), 409, /Not ready to publish.*not verified/);
    expect(await prisma.termResult.count({ where: { schoolId: A.schoolId, published: true } })).toBe(0);
  });
});

describe('getting the sheets verified', () => {
  it('goes through entry, submission and verification for both subjects', async () => {
    const test1 = await assessments.createAssessment(mathsTeacher, { assignmentId: mathsA, typeId: T['Class test'], title: 'Test 1', maxMark: 50 });
    const test2 = await assessments.createAssessment(englishTeacher, { assignmentId: englishA, typeId: T['Class test'], title: 'Essay test', maxMark: 20 });
    await marks.saveMarks(mathsTeacher, { assignmentId: mathsA, cells: kids.map((studentId, i) => ({ studentId, assessmentId: test1.id, value: [40, 35, 30, 20][i]!, code: null })) });
    await marks.saveMarks(englishTeacher, { assignmentId: englishA, cells: kids.map((studentId, i) => ({ studentId, assessmentId: test2.id, value: [10, 18, 12, 14][i]!, code: null })) });
    await enter(mathsTeacher, mathsA, exam['maths']!, [80, 70, 65, 40]);
    await enter(englishTeacher, englishA, exam['english']!, [50, 90, 60, 70]);
    await sheets.submitSheet(mathsTeacher, mathsA);
    await sheets.submitSheet(englishTeacher, englishA);
    await sheets.verifySheet(hod, mathsA);
    // Languages has no Head of Department: an administrator verifies (and is recorded).
    await sheets.verifySheet(admin, englishA);
    expect((await prisma.markSheet.findFirstOrThrow({ where: { assignmentId: englishA } })).verifiedById).toBe(A.operator!.id);
  });

  it('works out the overall average over both subjects, class and form positions, and positions', async () => {
    const rows = await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East }, orderBy: { classPosition: 'asc' } });
    // Maths: 0.4 x (80, 70, 60, 40) + 0.6 x exam;  English: 0.4 x (50, 90, 60, 70) + 0.6 x exam
    // kid1: 32 + 48 = 80 and 20 + 30 = 50 -> 65 ; kid2: 28 + 42 = 70 and 36 + 54 = 90 -> 80 ; kid3: 24 + 39 = 63 and 24 + 36 = 60 -> 61.5 ; kid4: 16 + 24 = 40 and 28 + 42 = 70 -> 55
    expect(rows.map((r) => [r.studentId, Number(r.averagePercentage), r.classPosition])).toEqual([[kids[1], 80, 1], [kids[0], 65, 2], [kids[2], 61.5, 3], [kids[3], 55, 4]]);
    expect(rows[0]).toMatchObject({ subjectsTaken: 2, classSize: 4, formPosition: 1, formSize: 4 });
    expect(rows[0]!.subjectsPassed).toBe(2);
  });
});

describe('comments', () => {
  it('keeps comments to 300 characters', async () => {
    await expect(publish.saveClassComments(englishTeacher, { classId: W.f2East, termId: A.termId, kind: 'CLASS_TEACHER', comments: [{ studentId: kids[0]!, text: 'x'.repeat(301) }] })).rejects.toThrow(/300/);
  });

  it('lets only the class teacher write the class comment, and only the Head the remark', async () => {
    await fails(publish.saveClassComments(mathsTeacher, { classId: W.f2East, termId: A.termId, kind: 'CLASS_TEACHER', comments: [{ studentId: kids[0]!, text: 'Good' }] }), 404);
    await fails(publish.saveClassComments(englishTeacher, { classId: W.f2East, termId: A.termId, kind: 'HEAD', comments: [{ studentId: kids[0]!, text: 'Good' }] }), 403);
    await publish.saveClassComments(englishTeacher, { classId: W.f2East, termId: A.termId, kind: 'CLASS_TEACHER', comments: kids.map((studentId) => ({ studentId, text: 'A pleasure to teach.' })) });
    const page = await publish.classComments(englishTeacher, W.f2East);
    expect(page.canWriteClass).toBe(true);
    expect(page.canWriteHead).toBe(false);
    expect(page.rows).toHaveLength(4);
    expect(page.rows[0]!.subjects.map((s) => s.subject).sort()).toEqual(['English Language', 'Mathematics']);
    expect(page.rows.every((r) => r.classTeacherComment === 'A pleasure to teach.')).toBe(true);
  });

  it('writes one Head remark for a band of the class and lets it be edited per student', async () => {
    const band = await publish.applyBandRemark(head, { classId: W.f2East, termId: A.termId, minAverage: 75, text: 'Excellent work, keep it up.' });
    expect(band.saved).toBe(1);
    const rest = await publish.applyBandRemark(head, { classId: W.f2East, termId: A.termId, minAverage: 0, maxAverage: 74.99, text: 'Work harder next term.' });
    expect(rest.saved).toBe(3);
    await publish.saveClassComments(head, { classId: W.f2East, termId: A.termId, kind: 'HEAD', comments: [{ studentId: kids[3]!, text: 'Needs extra lessons in Mathematics.' }] });
    const page = await publish.classComments(head, W.f2East);
    expect(page.rows.find((r) => r.studentId === kids[1])!.headRemark).toBe('Excellent work, keep it up.');
    expect(page.rows.find((r) => r.studentId === kids[3])!.headRemark).toBe('Needs extra lessons in Mathematics.');
  });

  it('keeps a subject teacher comment on the result', async () => {
    await publish.saveSubjectComments(mathsTeacher, { assignmentId: mathsA, comments: [{ studentId: kids[0]!, text: 'Strong in algebra.' }] });
    // The sheet is verified; comments can still be written until the results are published.
    const r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[0]!, subjectId: W.subjects.maths, termId: A.termId } });
    expect(r.teacherComment).toBe('Strong in algebra.');
  });

  it('is ready to publish now', async () => {
    const c = await publish.prePublishCheck(head, W.f2East);
    expect(c.problems.filter((p) => p.severity === 'block')).toEqual([]);
    expect(c.ready).toBe(true);
  });
});

describe('publishing', () => {
  it('is for the Head, not the teacher or the HOD', async () => {
    await fails(publish.publishClasses(mathsTeacher, { classIds: [W.f2East] }), 403);
    await fails(publish.publishClasses(hod, { classIds: [W.f2East] }), 403);
  });

  it('freezes the results as a snapshot, gives each card a code, copies the comments and tells the teachers', async () => {
    const r = await publish.publishClasses(head, { classIds: [W.f2East] });
    expect(r).toMatchObject({ classes: 1, students: 4, subjectResults: 8 });
    const rows = await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East } });
    expect(rows.every((x) => x.published && x.publishedAt && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(x.verificationCode!))).toBe(true);
    expect(new Set(rows.map((x) => x.verificationCode)).size).toBe(4);
    const top = rows.find((x) => x.studentId === kids[1])!;
    expect(top).toMatchObject({ classTeacherRemark: 'A pleasure to teach.', headRemark: 'Excellent work, keep it up.', letterGrade: 'A', classPosition: 1 });
    expect((await prisma.subjectResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId } })).every((x) => x.published)).toBe(true);
    expect((await prisma.markSheet.findMany({ where: { schoolId: A.schoolId, termId: A.termId } })).every((s) => s.status === 'PUBLISHED')).toBe(true);
    expect(await prisma.notification.count({ where: { userId: W.teachers.chikore, type: 'RESULTS_PUBLISHED' } })).toBe(1);
  });

  it('is locked: marks, comments and sheets cannot change, and the database refuses a published result', async () => {
    await fails(marks.saveMarks(mathsTeacher, { assignmentId: mathsA, cells: [{ studentId: kids[0]!, assessmentId: exam['maths']!, value: 99, code: null }] }), 409, /published/);
    await fails(publish.saveClassComments(head, { classId: W.f2East, termId: A.termId, kind: 'HEAD', comments: [{ studentId: kids[0]!, text: 'Changed' }] }), 409, /Unpublish/);
    await fails(sheets.unlockSheet(head, mathsA, { reason: 'Please let me' }), 409, /Unpublish the class first/);
    await expect(t.pg.query(`UPDATE "SubjectResult" SET "termMark" = 99 WHERE "studentId" = '${kids[0]}'`)).rejects.toThrow(/cannot be changed/);
    await expect(t.pg.query(`DELETE FROM "SubjectResult" WHERE "studentId" = '${kids[0]}'`)).rejects.toThrow(/cannot be deleted/);
  });

  it('does not change a published grade when the grading scale is edited afterwards', async () => {
    const before = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[0]!, subjectId: W.subjects.maths, termId: A.termId } });
    expect(before.grade).toBe('A'); // 80 on the default O Level scale
    await prisma.gradeBoundary.createMany({ data: [
      { schoolId: A.schoolId, category: 'O_LEVEL', letterGrade: 'A', minPercent: 90, maxPercent: 100, points: null, remark: 'Top' },
      { schoolId: A.schoolId, category: 'O_LEVEL', letterGrade: 'B', minPercent: 0, maxPercent: 89, points: null, remark: 'Rest' },
    ] });
    const card = await publish.reportCardData(head, kids[0]!, A.termId);
    expect(card.subjects.find((s) => s.subject === 'Mathematics')!.grade).toBe('A');
    const after = await prisma.subjectResult.findFirstOrThrow({ where: { id: before.id } });
    expect(after.grade).toBe('A');
    await prisma.gradeBoundary.deleteMany({ where: { schoolId: A.schoolId } });
  });
});

describe('report cards', () => {
  it('has everything the card shows, from the snapshot', async () => {
    const c = await publish.reportCardData(englishTeacher, kids[1]!, A.termId); // the class teacher
    expect(c.draft).toBe(false);
    expect(c.student).toMatchObject({ className: 'Form 2 East', admissionNumber: expect.any(String) });
    expect(c.planColumns).toEqual(['Class tests', 'End-of-term exam']);
    const eng = c.subjects.find((s) => s.subject === 'English Language')!;
    expect(eng).toMatchObject({ termMark: 90, rounded: 90, grade: 'A', position: '1 of 4' });
    expect(eng.typeScores).toEqual([90, 90]);
    expect(c.summary).toMatchObject({ average: 80, classPosition: '1 of 4', formPosition: '1 of 4', passes: 2, isOLevel: true, overallGrade: 'A' });
    expect(c.comments).toMatchObject({ classTeacher: 'A pleasure to teach.', head: 'Excellent work, keep it up.' });
    expect(c.verificationCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('is not shown to a teacher who has nothing to do with the class', async () => {
    await fails(publish.reportCardData(await actorOf(prisma, W.teachers.dube), kids[1]!, A.termId), 404);
  });

  it('is checked on a public page by its code: name, class, term and average', async () => {
    const code = (await prisma.termResult.findFirstOrThrow({ where: { studentId: kids[1]! , termId: A.termId } })).verificationCode!;
    const v = await publish.verifyReportCard(code);
    expect(v).toMatchObject({ valid: true, className: 'Form 2 East', term: expect.any(String), average: 80, position: '1 of 4' });
    expect((await publish.verifyReportCard(code.toLowerCase())).valid).toBe(true);
    expect((await publish.verifyReportCard('ZZZZ-ZZZZ')).valid).toBe(false);
    expect((await publish.verifyReportCard('nonsense')).valid).toBe(false);
  });
});

describe('unpublishing and republishing', () => {
  it('needs a reason, and only the Head can do it', async () => {
    await fails(publish.unpublishClasses(hod, { classIds: [W.f2East], reason: 'Wrong exam mark' }), 403);
    await expect(publish.unpublishClasses(head, { classIds: [W.f2East], reason: '' })).rejects.toThrow();
  });

  it('takes the class off report cards, invalidates the old codes and puts the sheets back to verified', async () => {
    const oldCode = (await prisma.termResult.findFirstOrThrow({ where: { studentId: kids[1]!, termId: A.termId } })).verificationCode!;
    await publish.unpublishClasses(head, { classIds: [W.f2East], reason: 'Wrong exam mark in Mathematics' });
    expect(await prisma.termResult.count({ where: { schoolId: A.schoolId, termId: A.termId, published: true } })).toBe(0);
    expect(await prisma.subjectResult.count({ where: { schoolId: A.schoolId, termId: A.termId, published: true } })).toBe(0);
    expect((await publish.verifyReportCard(oldCode)).valid).toBe(false);
    await fails(publish.reportCardData(englishTeacher, kids[1]!, A.termId), 409, /not been published/);
    const events = await prisma.markSheetEvent.findMany({ where: { action: 'UNPUBLISH' } });
    expect(events).toHaveLength(2);
    expect(events[0]!.comment).toBe('Wrong exam mark in Mathematics');
    expect((await prisma.markSheet.findMany({ where: { schoolId: A.schoolId } })).every((s) => s.status === 'VERIFIED')).toBe(true);
  });

  it('lets the Head unlock the sheet, the teacher correct it with a reason, and the whole class be recalculated on republishing', async () => {
    await sheets.unlockSheet(head, mathsA, { reason: 'Wrong exam mark in Mathematics' });
    await marks.saveMarks(mathsTeacher, { assignmentId: mathsA, reason: 'Wrong exam mark in Mathematics', cells: [{ studentId: kids[0]!, assessmentId: exam['maths']!, value: 100, code: null }] });
    await sheets.submitSheet(mathsTeacher, mathsA);
    await sheets.verifySheet(hod, mathsA);
    // kid1 (index 0): maths 0.4 x 80 + 0.6 x 100 = 92 and English 50 -> 71: now second behind kid2 (80); positions change
    const r = await publish.publishClasses(head, { classIds: [W.f2East] });
    expect(r.students).toBe(4);
    const rows = await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, classId: W.f2East }, orderBy: { classPosition: 'asc' } });
    expect(rows.map((x) => [x.studentId, Number(x.averagePercentage), x.classPosition])).toEqual([[kids[1], 80, 1], [kids[0], 71, 2], [kids[2], 61.5, 3], [kids[3], 55, 4]]);
    expect(rows.every((x) => x.published)).toBe(true);
    const history = await prisma.assessmentMarkChange.findMany({ where: { schoolId: A.schoolId } });
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toBe('Wrong exam mark in Mathematics');
  });

  it('gives republished cards new codes', async () => {
    const codes = (await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, published: true } })).map((x) => x.verificationCode);
    expect(codes.every((c) => !!c)).toBe(true);
  });
});

describe('excusing an absence', () => {
  it('is the Head\'s call, leaves the assessment out of the term mark and keeps a history row', async () => {
    await publish.unpublishClasses(head, { classIds: [W.f2East], reason: 'Absence to be excused' });
    await sheets.unlockSheet(head, englishA, { reason: 'Absence to be excused' });
    // kid4 missed the English exam through illness: AB first, then excused by the Head.
    await marks.saveMarks(englishTeacher, { assignmentId: englishA, reason: 'Was ill', cells: [{ studentId: kids[3]!, assessmentId: exam['english']!, value: null, code: 'AB' }] });
    await sheets.submitSheet(englishTeacher, englishA);
    await sheets.verifySheet(admin, englishA);
    let r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[3]!, subjectId: W.subjects.english, termId: A.termId } });
    expect(Number(r.termMark)).toBe(28); // test 70% x 0.4; exam counts 0
    await fails(marks.excuseAbsence(englishTeacher, { assignmentId: englishA, assessmentId: exam['english']!, studentId: kids[3]!, reason: 'Was ill' }), 403);
    await marks.excuseAbsence(head, { assignmentId: englishA, assessmentId: exam['english']!, studentId: kids[3]!, reason: 'Medical certificate seen' });
    r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[3]!, subjectId: W.subjects.english, termId: A.termId } });
    expect(Number(r.termMark)).toBe(70); // the exam is left out and the test weight scales up to 100%
    const m = await prisma.assessmentMark.findFirstOrThrow({ where: { studentId: kids[3]!, assessmentId: exam['english']! } });
    expect(m.code).toBe('AB_EXCUSED');
    const changes = await prisma.assessmentMarkChange.findMany({ where: { markId: m.id }, orderBy: { createdAt: 'asc' } });
    expect(changes.map((c) => [c.oldCode, c.newCode, c.reason])).toEqual([[null, 'AB', 'Was ill'], ['AB', 'AB_EXCUSED', 'Medical certificate seen']]);
    // The teacher cannot turn it back into a plain absence.
    await sheets.unlockSheet(head, englishA, { reason: 'check' });
    const back = await marks.saveMarks(englishTeacher, { assignmentId: englishA, reason: 'oops', cells: [{ studentId: kids[3]!, assessmentId: exam['english']!, value: null, code: 'AB' }] });
    expect(back.outcomes[0]).toMatchObject({ status: 'rejected', message: expect.stringMatching(/Head excused/) });
  });
});

describe('a Form 4 class and the 5-passes flag', () => {
  it('flags 5 or more passes including English and Mathematics, and counts A Level points for the best three', async () => {
    const f4 = await prisma.level.upsert({ where: { schoolId_order: { schoolId: A.schoolId, order: 4 } }, update: {}, create: { schoolId: A.schoolId, name: 'Form 4', order: 4, category: 'O_LEVEL' } });
    const klass = await prisma.schoolClass.create({ data: { schoolId: A.schoolId, name: 'Form 4 West', levelId: f4.id, stream: 'West' } });
    const subjectsF4 = [W.subjects.maths, W.subjects.english, W.subjects.science, W.subjects.geography, W.subjects.history, W.subjects.accounts];
    const { students } = await import('../helpers/academics');
    const kidsF4 = await students(prisma, A, klass.id, 2, 'Senior');
    await setup.saveExamSettings(admin, { englishSubjectId: W.subjects.english, mathsSubjectId: W.subjects.maths });
    await setup.savePlan(officer, { termId: A.termId, levelId: f4.id, lines: [{ label: 'Exam', weight: 100, rule: 'AVERAGE', typeIds: [T['Class test']!] }] });
    let n = 0;
    for (const subjectId of subjectsF4) {
      await takeSubject(prisma, A, kidsF4, subjectId);
      const ta = await prisma.teacherAssignment.create({ data: { schoolId: A.schoolId, termId: A.termId, teacherId: W.teachers.dube, subjectId, classId: klass.id, startDate: new Date('2026-09-01') } });
      const dube = await actorOf(prisma, W.teachers.dube);
      const a = await assessments.createAssessment(dube, { assignmentId: ta.id, typeId: T['Class test'], title: `T${n}`, maxMark: 100 });
      // student 1 passes everything (60); student 2 fails Mathematics (30) but passes the rest.
      await marks.saveMarks(dube, { assignmentId: ta.id, cells: [{ studentId: kidsF4[0]!, assessmentId: a.id, value: 60, code: null }, { studentId: kidsF4[1]!, assessmentId: a.id, value: subjectId === W.subjects.maths ? 30 : 60, code: null }] });
      await sheets.submitSheet(dube, ta.id);
      await sheets.verifySheet([W.subjects.maths, W.subjects.science].includes(subjectId) ? hod : admin, ta.id); // the Head of Sciences, or the alternate of the other departments
      n++;
    }
    const rows = await prisma.termResult.findMany({ where: { schoolId: A.schoolId, termId: A.termId, classId: klass.id } });
    expect(rows.find((r) => r.studentId === kidsF4[0])).toMatchObject({ subjectsPassed: 6, fivePassesEngMaths: true });
    expect(rows.find((r) => r.studentId === kidsF4[1])).toMatchObject({ subjectsPassed: 5, fivePassesEngMaths: false });
  });
});
