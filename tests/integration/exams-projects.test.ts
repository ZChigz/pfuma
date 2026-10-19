// @vitest-environment node
// School-based projects: templates with stages and rubrics, starting one in a class, marking by stage and by rubric, evidence for
// moderation, copying a template to the next term, and the project total feeding the term mark.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/test-db';
import { seedSchool, type SeededSchool } from '../helpers/seed';
import { actorOf } from '../helpers/academics';
import { classWith, examWorld, typeIds, type ExamWorld } from '../helpers/exams';

let t: TestDb;
let A: SeededSchool;
let B: SeededSchool;
let W: ExamWorld;
let prisma: typeof import('@/lib/prisma').prisma;
let setup: typeof import('@/lib/exams/setup');
let projects: typeof import('@/lib/exams/projects');
let marks: typeof import('@/lib/exams/marks');
let sheets: typeof import('@/lib/exams/sheets');
type Actor = Awaited<ReturnType<typeof actorOf>>;

let teacher: Actor; let officer: Actor; let hod: Actor; let other: Actor;
let kids: string[]; let assignmentId: string;
let templateId: string; let assessmentId: string;
let plainStage: string; let rubricStage: string;
let rubric: { criteria: { id: string; levels: { id: string; marks: number }[] }[] };
let T: Record<string, string>;

const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try { await p; } catch (e) {
    const err = e as { status?: number; message: string };
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};

const level = (marks: number[], label = 'L') => marks.map((m, i) => ({ label: `${label}${i}`, descriptor: `descriptor ${i}`, marks: m }));

beforeAll(async () => {
  t = await startTestDb();
  ({ prisma } = await import('@/lib/prisma'));
  setup = await import('@/lib/exams/setup');
  projects = await import('@/lib/exams/projects');
  marks = await import('@/lib/exams/marks');
  sheets = await import('@/lib/exams/sheets');
  A = await seedSchool(prisma, 'School A');
  B = await seedSchool(prisma, 'School B');
  W = await examWorld(prisma, A);
  const room = await classWith(prisma, A, { classId: W.f2East, subjectId: W.subjects.maths, teacherId: W.teachers.chikore, count: 3, prefix: 'Proj' });
  kids = room.kids; assignmentId = room.assignmentId;
  teacher = await actorOf(prisma, W.teachers.chikore);
  officer = await actorOf(prisma, W.examsOfficer);
  hod = await actorOf(prisma, W.hod);
  other = await actorOf(prisma, W.teachers.ncube);
  await setup.listTypes(officer);
  T = await typeIds(prisma, A);
  await setup.savePlan(officer, { termId: A.termId, levelId: W.form2, lines: [{ label: 'School-based project', weight: 100, rule: 'AVERAGE', typeIds: [T['School-based project']!] }] });
}, 240_000);

afterAll(async () => {
  await prisma.$disconnect();
  await t.stop();
});

describe('project templates', () => {
  const body = () => ({
    title: 'Statistics project', subjectId: W.subjects.maths, levelId: W.form2, startDate: '2026-09-01', dueDate: '2026-11-15',
    stages: [
      { name: 'Proposal', maxMark: 20 },
      { name: 'Final report', rubric: { criteria: [{ name: 'Research', levels: level([4, 3, 2, 1]) }, { name: 'Method', levels: level([4, 3, 2, 1]) }, { name: 'Presentation', levels: level([4, 2, 0]) }] } },
    ],
  });

  it('is for the Exams Officer, not a teacher', async () => {
    await fails(projects.createTemplate(teacher, body()), 403);
  });

  it('works out a rubric stage\'s maximum from the best level of each criterion', async () => {
    const r = await projects.createTemplate(officer, body());
    templateId = r.id;
    const list = await projects.listTemplates(officer);
    const tpl = list.find((x) => x.id === templateId)!;
    expect(tpl.stages.map((s) => [s.name, s.maxMark])).toEqual([['Proposal', 20], ['Final report', 12]]);
    expect(tpl.total).toBe(32);
    plainStage = tpl.stages[0]!.id; rubricStage = tpl.stages[1]!.id;
    rubric = tpl.stages[1]!.rubric!;
    expect(tpl.stages[1]!.rubric!.criteria).toHaveLength(3);
  });

  it('refuses a stage with neither a maximum mark nor a rubric, and a due date before the start', async () => {
    await expect(projects.createTemplate(officer, { ...body(), stages: [{ name: 'Nothing' }] })).rejects.toThrow();
    await expect(projects.createTemplate(officer, { ...body(), startDate: '2026-11-01', dueDate: '2026-10-01' })).rejects.toThrow();
    await fails(projects.createTemplate(officer, { ...body(), subjectId: B.subjectId }), 404);
  });

  it('is not reachable from another school', async () => {
    const outsider = await actorOf(prisma, B.users.ADMIN.id);
    expect((await projects.listTemplates(outsider)).length).toBe(0);
    await fails(projects.updateTemplate(outsider, templateId, { title: 'hijack' }), 404);
  });
});

describe('starting a project in a class', () => {
  it('lets the teacher start it once, with the stages as columns and the total as the maximum', async () => {
    const r = await projects.startProject(teacher, { templateId, assignmentId });
    assessmentId = r.id;
    const a = await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
    expect(Number(a.maxMark)).toBe(32);
    expect(a.assignmentId).toBe(assignmentId);
    await fails(projects.startProject(teacher, { templateId, assignmentId }), 409, /already been started/);
    const g = await marks.loadGrid(teacher, assignmentId);
    expect(g.columns.map((c) => [c.stageName, c.max, c.rubric])).toEqual([['Proposal', 20, false], ['Final report', 12, true]]);
  });

  it('is only for the teacher of the class, and only for the subject and form of the project', async () => {
    await fails(projects.startProject(other, { templateId, assignmentId }), 404);
    const english = await classWith(prisma, A, { classId: W.f1South, subjectId: W.subjects.english, teacherId: W.teachers.chikore, count: 1, prefix: 'Eng' });
    await fails(projects.startProject(teacher, { templateId, assignmentId: english.assignmentId }), 422, /different subject or form/);
  });

  it('is started once for every class by the Exams Officer', async () => {
    const copy = await projects.copyTemplate(officer, templateId, { title: 'Common project' });
    const r = await projects.startCommonProject(officer, { templateId: copy.id, termId: A.termId, countsToTerm: false });
    const a = await prisma.assessment.findUniqueOrThrow({ where: { id: r.id } });
    expect(a.assignmentId).toBeNull();
    await fails(projects.startCommonProject(officer, { templateId: copy.id, termId: A.termId }), 409);
    await fails(projects.startCommonProject(teacher, { templateId: copy.id, termId: A.termId }), 403);
  });
});

describe('marking a project', () => {
  it('takes marks for a plain stage up to its own maximum', async () => {
    const r = await marks.saveMarks(teacher, { assignmentId, cells: [
      { studentId: kids[0]!, assessmentId, stageId: plainStage, value: 18, code: null },
      { studentId: kids[1]!, assessmentId, stageId: plainStage, value: 21, code: null },
      { studentId: kids[2]!, assessmentId, stageId: plainStage, value: null, code: 'AB' },
    ] });
    expect(r.outcomes.map((o) => o.status)).toEqual(['saved', 'rejected', 'saved']);
    expect((r.outcomes[1] as { message: string }).message).toMatch(/maximum of 20/);
  });

  it('does not take a typed mark for a stage that is marked with a rubric', async () => {
    const r = await marks.saveMarks(teacher, { assignmentId, cells: [{ studentId: kids[0]!, assessmentId, stageId: rubricStage, value: 10, code: null }] });
    expect(r.outcomes[0]).toMatchObject({ status: 'rejected', message: expect.stringMatching(/rubric/) });
  });

  it('refuses a stage on an assessment that has none, and a missing stage on a project', async () => {
    const r = await marks.saveMarks(teacher, { assignmentId, cells: [{ studentId: kids[0]!, assessmentId, value: 10, code: null }] });
    expect(r.outcomes[0]).toMatchObject({ status: 'rejected', message: expect.stringMatching(/Choose a stage/) });
  });

  it('adds up the levels clicked: the stage mark is saved when every criterion has a level', async () => {
    const [c1, c2, c3] = rubric.criteria;
    const partial = await projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: kids[0]!, scores: [{ criterionId: c1!.id, levelId: c1!.levels[0]!.id }] });
    expect(partial).toMatchObject({ complete: false, total: null });
    expect(await prisma.assessmentMark.findFirstOrThrow({ where: { studentId: kids[0]!, stageId: rubricStage } })).toMatchObject({ value: null, code: null });
    const full = await projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: kids[0]!, scores: [
      { criterionId: c1!.id, levelId: c1!.levels[0]!.id }, { criterionId: c2!.id, levelId: c2!.levels[1]!.id }, { criterionId: c3!.id, levelId: c3!.levels[0]!.id },
    ] });
    expect(full).toMatchObject({ complete: true, total: 11 }); // 4 + 3 + 4
    expect(Number((await prisma.assessmentMark.findFirstOrThrow({ where: { studentId: kids[0]!, stageId: rubricStage } })).value)).toBe(11);
    const view = await projects.rubricFor(teacher, assignmentId, assessmentId, rubricStage, kids[0]!);
    expect(view).toMatchObject({ total: 11, complete: true });
    expect(view.criteria.every((c) => c.chosenLevelId)).toBe(true);
  });

  it('refuses a level that belongs to another criterion, and a student who does not take the subject', async () => {
    const [c1, c2] = rubric.criteria;
    await fails(projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: kids[1]!, scores: [{ criterionId: c1!.id, levelId: c2!.levels[0]!.id }] }), 422, /does not belong/);
    const { addStudent } = await import('../helpers/students');
    const stray = await addStudent(prisma, A, { classId: W.f2East });
    await fails(projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: stray.id, scores: [{ criterionId: c1!.id, levelId: c1!.levels[0]!.id }] }), 422, /does not take the subject/);
  });

  it('feeds the term mark: the project total over its maximum, with a stage left out when exempt', async () => {
    const [c1, c2, c3] = rubric.criteria;
    for (const [k, picks] of [[kids[1]!, [0, 0, 1]], [kids[2]!, [3, 3, 2]]] as const) {
      await projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: k, scores: [
        { criterionId: c1!.id, levelId: c1!.levels[picks[0]]!.id }, { criterionId: c2!.id, levelId: c2!.levels[picks[1]]!.id }, { criterionId: c3!.id, levelId: c3!.levels[picks[2]]!.id },
      ] });
    }
    // kids[1] had 21 refused for the proposal: give a valid mark now.
    await marks.saveMarks(teacher, { assignmentId, cells: [{ studentId: kids[1]!, assessmentId, stageId: plainStage, value: 20, code: null }] });
    const g = await marks.loadGrid(teacher, assignmentId);
    // kids[0]: 18 + 11 = 29 of 32 = 90.625 -> 90.63 -> 91 ; kids[1]: 20 + (4+4+2) = 30 of 32 = 93.75 ; kids[2]: AB (0 of 20) + (1+1+0) = 2 of 32 = 6.25
    expect(g.preview[kids[0]!]).toMatchObject({ termMark: 90.63, roundedMark: 91 });
    expect(g.preview[kids[1]!]!.termMark).toBe(93.75);
    expect(g.preview[kids[2]!]!.termMark).toBe(6.25);
  });

  it('can be submitted and verified, and the project total is the term mark', async () => {
    await sheets.submitSheet(teacher, assignmentId);
    await sheets.verifySheet(hod, assignmentId);
    const r = await prisma.subjectResult.findFirstOrThrow({ where: { studentId: kids[0]!, subjectId: W.subjects.maths, termId: A.termId } });
    expect(Number(r.termMark)).toBe(90.63);
    expect((r.typeScores as { label: string; score: number }[])[0]).toMatchObject({ label: 'School-based project', score: 90.63 });
  });

  it('keeps the rubric changes after submission in the mark history, and needs a reason', async () => {
    await sheets.unlockSheet(await actorOf(prisma, A.users.HEAD.id), assignmentId, { reason: 'Re-moderated the final report' });
    const [c1, c2, c3] = rubric.criteria;
    const scores = [{ criterionId: c1!.id, levelId: c1!.levels[1]!.id }, { criterionId: c2!.id, levelId: c2!.levels[1]!.id }, { criterionId: c3!.id, levelId: c3!.levels[0]!.id }];
    await fails(projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: kids[0]!, scores }), 422, /reason/);
    await projects.scoreRubric(teacher, { assignmentId, assessmentId, stageId: rubricStage, studentId: kids[0]!, scores, reason: 'Re-moderated the final report' });
    const changes = await prisma.assessmentMarkChange.findMany({ where: { schoolId: A.schoolId } });
    expect(changes).toHaveLength(1);
    expect(Number(changes[0]!.oldValue)).toBe(11);
    expect(Number(changes[0]!.newValue)).toBe(10);
  });
});

describe('evidence', () => {
  const key = (school: string) => `mev:${school}:0123456789abcdef`;

  it("attaches a photo to a student stage, opened later through a link that expires", async () => {
    const ev = await projects.addEvidence(teacher, { assignmentId, assessmentId, studentId: kids[0]!, stageId: rubricStage, fileKey: key(A.schoolId), fileName: 'poster.jpg', contentType: 'image/jpeg' }).catch((e) => e);
    // The sheet was unlocked in the previous group, so this succeeds.
    expect(ev.id).toBeTruthy();
    const link = await projects.evidenceLink(hod, ev.id, async (k, ttl) => `https://files.example/${k}?ttl=${ttl}`);
    expect(link.url).toContain('?ttl=10m');
    const view = await projects.rubricFor(teacher, assignmentId, assessmentId, rubricStage, kids[0]!);
    expect(view.evidence).toHaveLength(1);
  });

  it('refuses a key from another school, a file type that is not a photo or PDF, and a teacher of another class', async () => {
    await fails(projects.addEvidence(teacher, { assignmentId, assessmentId, studentId: kids[0]!, stageId: rubricStage, fileKey: key(B.schoolId), fileName: 'x.jpg', contentType: 'image/jpeg' }), 422, /does not belong/);
    await expect(projects.addEvidence(teacher, { assignmentId, assessmentId, studentId: kids[0]!, stageId: rubricStage, fileKey: key(A.schoolId), fileName: 'x.exe', contentType: 'application/x-msdownload' })).rejects.toThrow();
    await fails(projects.addEvidence(other, { assignmentId, assessmentId, studentId: kids[0]!, stageId: rubricStage, fileKey: key(A.schoolId), fileName: 'x.jpg', contentType: 'image/jpeg' }), 404);
    const ev = await prisma.markEvidence.findFirstOrThrow({ where: { schoolId: A.schoolId } });
    await fails(projects.evidenceLink(other, ev.id, async () => 'x'), 404);
  });
});

describe('changing and copying a template', () => {
  it('changes the dates any time, but the stages only while no mark is entered', async () => {
    await projects.updateTemplate(officer, templateId, { dueDate: '2026-12-01' });
    await fails(projects.updateTemplate(officer, templateId, { stages: [{ name: 'Only stage', maxMark: 50 }] }), 409, /Marks have been entered/);
    const fresh = await projects.createTemplate(officer, { title: 'Fresh', subjectId: W.subjects.maths, levelId: W.form2, stages: [{ name: 'One', maxMark: 10 }] });
    await projects.updateTemplate(officer, fresh.id, { stages: [{ name: 'One', maxMark: 10 }, { name: 'Two', maxMark: 15 }] });
    const list = await projects.listTemplates(officer);
    expect(list.find((x) => x.id === fresh.id)!.total).toBe(25);
  });

  it('copies a template with its stages and rubric for the next term, without marks', async () => {
    const copy = await projects.copyTemplate(officer, templateId, { title: 'Statistics project 2027', startDate: '2027-01-12', dueDate: '2027-04-01' });
    const tpl = (await projects.listTemplates(officer)).find((x) => x.id === copy.id)!;
    expect(tpl).toMatchObject({ title: 'Statistics project 2027', total: 32, inUse: false, startDate: '2027-01-12' });
    expect(tpl.stages[1]!.rubric!.criteria.map((c) => c.name)).toEqual(['Research', 'Method', 'Presentation']);
    expect((await prisma.projectTemplate.findUniqueOrThrow({ where: { id: copy.id } })).copiedFromId).toBe(templateId);
  });
});
