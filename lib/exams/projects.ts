// School-based projects (which replaced CALA).
//
// A project template has a title, subject, level, start and due dates, a brief (an uploaded file) and stages (Proposal,
// Research, Practical work, Final report ...), each with its own maximum mark or a rubric. A rubric has criteria with level
// descriptors and marks per level; the teacher clicks a level per criterion and the total is calculated. Evidence (photos or
// files) is attached per student per stage so moderation can see the work. Each student's project total feeds the term
// weighting plan like any other assessment type.
//
// A template can be copied to the next term or year. A teacher starts a project for their class from a template; the
// Exams Officer can start it once for every class of the subject at the level.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { round2 } from '@/lib/results';
import { signStudentFile } from '@/lib/students/storage';
import { writeCells } from '@/lib/exams/marks';
import { openForEntry } from '@/lib/exams/entry';
import { EVIDENCE_TYPES, keyBelongs } from '@/lib/exams/keys';
import {
  assertOwnAssignment, classNameOf, ensureDefaultTypes, holds, idSchema, isoDateSchema, levelIdOf, loadAssignment, num, rosterOf, toDay, type Actor,
} from '@/lib/exams/common';

const need = (user: Actor, permission: Parameters<typeof holds>[1]) => {
  if (!holds(user, permission)) throw new ServiceError('Forbidden', 403);
};

// ─── Input ───────────────────────────────────────────────────────────────────

const levelInput = z.object({
  label: z.string().trim().min(1, 'Name the level').max(40),
  descriptor: z.string().trim().max(300).nullish(),
  marks: z.number().min(0).max(1000).refine((n) => round2(n) === n, 'Use at most two decimal places'),
});
const criterionInput = z.object({
  name: z.string().trim().min(1, 'Name the criterion').max(80),
  levels: z.array(levelInput).min(2, 'A criterion needs at least two levels').max(8),
});
const stageInput = z.object({
  name: z.string().trim().min(1, 'Name the stage').max(80),
  /** The stage's maximum mark; for a rubric stage it is worked out from the rubric. */
  maxMark: z.number().gt(0).max(1000).refine((n) => round2(n) === n, 'Use at most two decimal places').optional(),
  rubric: z.object({ criteria: z.array(criterionInput).min(1, 'A rubric needs at least one criterion').max(12) }).optional(),
}).refine((s) => s.rubric || s.maxMark, { message: 'Give the stage a maximum mark or a rubric', path: ['maxMark'] });

const templateBase = z.object({
  title: z.string().trim().min(1, 'Give the project a title').max(120),
  subjectId: idSchema,
  levelId: idSchema,
  startDate: isoDateSchema.nullish(),
  dueDate: isoDateSchema.nullish(),
  briefFileKey: z.string().trim().min(10).max(200).nullish(),
  briefFileName: z.string().trim().max(200).nullish(),
  stages: z.array(stageInput).min(1, 'A project needs at least one stage').max(10),
});
const datesInOrder = (t: { startDate?: string | null; dueDate?: string | null }) => !t.startDate || !t.dueDate || t.dueDate >= t.startDate;
const datesIssue = { path: ['dueDate'], message: 'The due date cannot be before the start date' };
export const TemplateSchema = templateBase.refine(datesInOrder, datesIssue);


/** The maximum mark of a rubric stage: the best level of every criterion added up. */
export const rubricMax = (criteria: { levels: { marks: number }[] }[]) => round2(criteria.reduce((a, c) => a + Math.max(...c.levels.map((l) => l.marks)), 0));

// ─── Templates ───────────────────────────────────────────────────────────────

const templateInclude = {
  subject: { select: { name: true } }, level: { select: { name: true } },
  stages: { orderBy: { sortOrder: 'asc' as const }, include: { rubric: { include: { criteria: { orderBy: { sortOrder: 'asc' as const }, include: { levels: { orderBy: { sortOrder: 'asc' as const } } } } } } } },
} satisfies Prisma.ProjectTemplateInclude;
type TemplateRow = Prisma.ProjectTemplateGetPayload<{ include: typeof templateInclude }>;

export interface TemplateView {
  id: string; title: string; subjectId: string; subject: string; levelId: string; level: string;
  startDate: string | null; dueDate: string | null; briefFileKey: string | null; briefFileName: string | null; active: boolean; total: number; inUse: boolean;
  stages: { id: string; name: string; maxMark: number; rubric: { id: string; criteria: { id: string; name: string; levels: { id: string; label: string; descriptor: string | null; marks: number }[] }[] } | null }[];
}

const dayText = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const viewOf = (t: TemplateRow, inUse: boolean): TemplateView => ({
  id: t.id, title: t.title, subjectId: t.subjectId, subject: t.subject.name, levelId: t.levelId, level: t.level.name, startDate: dayText(t.startDate), dueDate: dayText(t.dueDate),
  briefFileKey: t.briefFileKey, briefFileName: t.briefFileName, active: t.active, inUse,
  total: round2(t.stages.reduce((a, s) => a + num(s.maxMark)!, 0)),
  stages: t.stages.map((s) => ({
    id: s.id, name: s.name, maxMark: num(s.maxMark)!,
    rubric: s.rubric ? { id: s.rubric.id, criteria: s.rubric.criteria.map((c) => ({ id: c.id, name: c.name, levels: c.levels.map((l) => ({ id: l.id, label: l.label, descriptor: l.descriptor, marks: num(l.marks)! })) })) } : null,
  }),
  ),
});

export async function listTemplates(user: Actor, filter: { subjectId?: string; levelId?: string } = {}): Promise<TemplateView[]> {
  if (!holds(user, 'exams.projects.manage') && !holds(user, 'exams.assessments.create')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.projectTemplate.findMany({
      where: { schoolId: user.schoolId, ...(filter.subjectId ? { subjectId: filter.subjectId } : {}), ...(filter.levelId ? { levelId: filter.levelId } : {}) },
      include: templateInclude, orderBy: [{ level: { order: 'asc' } }, { title: 'asc' }],
    });
    const used = await tx.assessment.groupBy({ by: ['projectId'], where: { schoolId: user.schoolId, projectId: { in: rows.map((r) => r.id) } } });
    const inUse = new Set(used.map((u) => u.projectId));
    return rows.map((r) => viewOf(r, inUse.has(r.id)));
  });
}

async function writeStages(tx: Db, schoolId: string, templateId: string, stages: z.infer<typeof stageInput>[]) {
  for (const [i, s] of Array.from(stages.entries())) {
    const max = s.rubric ? rubricMax(s.rubric.criteria) : s.maxMark!;
    if (!(max > 0)) throw new ServiceError(`${s.name}: the rubric must be worth more than 0 marks`, 422);
    const stage = await tx.projectStage.create({ data: { schoolId, templateId, name: s.name, sortOrder: i, maxMark: max } });
    if (s.rubric) {
      const rubric = await tx.rubric.create({ data: { schoolId, stageId: stage.id } });
      for (const [ci, c] of Array.from(s.rubric.criteria.entries())) {
        const crit = await tx.rubricCriterion.create({ data: { schoolId, rubricId: rubric.id, name: c.name, sortOrder: ci } });
        await tx.rubricLevel.createMany({ data: c.levels.map((l, li) => ({ schoolId, criterionId: crit.id, label: l.label, descriptor: l.descriptor ?? null, marks: l.marks, sortOrder: li })) });
      }
    }
  }
}

async function checkSubjectLevel(tx: Db, schoolId: string, subjectId: string, levelId: string) {
  const [subject, level] = await Promise.all([tx.subject.findFirst({ where: { id: subjectId, schoolId } }), tx.level.findFirst({ where: { id: levelId, schoolId } })]);
  if (!subject) throw new ServiceError('Subject not found', 404);
  if (!level) throw new ServiceError('Level not found', 404);
  return { subject, level };
}

export async function createTemplate(user: Actor, raw: unknown) {
  need(user, 'exams.projects.manage');
  const input = TemplateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { subject, level } = await checkSubjectLevel(tx, user.schoolId, input.subjectId, input.levelId);
    if (input.briefFileKey && !keyBelongs(input.briefFileKey, user.schoolId, 'mbf')) throw new ServiceError('That file does not belong to this school', 422);
    const t = await tx.projectTemplate.create({
      data: {
        schoolId: user.schoolId, title: input.title, subjectId: subject.id, levelId: level.id, startDate: input.startDate ? toDay(input.startDate) : null,
        dueDate: input.dueDate ? toDay(input.dueDate) : null, briefFileKey: input.briefFileKey ?? null, briefFileName: input.briefFileName ?? null, createdById: user.id,
      },
    });
    await writeStages(tx, user.schoolId, t.id, input.stages);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_PROJECT', entityType: 'ProjectTemplate', entityId: t.id, detail: `Created project ${t.title} (${subject.name}, ${level.name}) with ${input.stages.length} stage(s)` }, tx);
    return { id: t.id };
  });
}

/** Marks entered for any stage of the project (through an assessment started from it). */
async function marksExist(tx: Db, schoolId: string, templateId: string) {
  return (await tx.assessmentMark.count({ where: { schoolId, assessment: { projectId: templateId }, OR: [{ value: { not: null } }, { code: { not: null } }] } })) > 0;
}

const UpdateSchema = templateBase.partial().refine(datesInOrder, datesIssue);

/**
 * Changes a template. The title, dates and brief can always change; the stages and rubric only while no mark has been entered
 * (a mark's maximum is fixed once it exists), in which case the projects started from it follow the new total.
 */
export async function updateTemplate(user: Actor, id: string, raw: unknown) {
  need(user, 'exams.projects.manage');
  const input = UpdateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.projectTemplate.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!t) throw new ServiceError('Project not found', 404);
    if (input.briefFileKey && !keyBelongs(input.briefFileKey, user.schoolId, 'mbf')) throw new ServiceError('That file does not belong to this school', 422);
    if (input.stages) {
      if (await marksExist(tx, user.schoolId, id)) throw new ServiceError('Marks have been entered for this project, so its stages cannot change. Copy the project instead.', 409);
      const stageIds = (await tx.projectStage.findMany({ where: { templateId: id }, select: { id: true } })).map((s) => s.id);
      if (stageIds.length) {
        const rubrics = await tx.rubric.findMany({ where: { stageId: { in: stageIds } }, select: { id: true } });
        const crit = await tx.rubricCriterion.findMany({ where: { rubricId: { in: rubrics.map((r) => r.id) } }, select: { id: true } });
        await tx.rubricLevel.deleteMany({ where: { criterionId: { in: crit.map((c) => c.id) } } });
        await tx.rubricCriterion.deleteMany({ where: { rubricId: { in: rubrics.map((r) => r.id) } } });
        await tx.rubric.deleteMany({ where: { stageId: { in: stageIds } } });
        await tx.projectStage.deleteMany({ where: { templateId: id } });
      }
      await writeStages(tx, user.schoolId, id, input.stages);
      const total = round2(input.stages.reduce((a, s) => a + (s.rubric ? rubricMax(s.rubric.criteria) : s.maxMark!), 0));
      await tx.assessment.updateMany({ where: { projectId: id }, data: { maxMark: total } });
    }
    await tx.projectTemplate.update({
      where: { id },
      data: {
        title: input.title, ...(input.startDate !== undefined ? { startDate: input.startDate ? toDay(input.startDate) : null } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? toDay(input.dueDate) : null } : {}),
        ...(input.briefFileKey !== undefined ? { briefFileKey: input.briefFileKey, briefFileName: input.briefFileName ?? null } : {}),
      },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_PROJECT', entityType: 'ProjectTemplate', entityId: id, detail: `Changed project ${input.title ?? t.title}${input.stages ? ' (stages replaced)' : ''}` }, tx);
    return { id };
  });
}

const CopySchema = z.object({ title: z.string().trim().min(1).max(120).optional(), startDate: isoDateSchema.nullish(), dueDate: isoDateSchema.nullish() });

/** Copies a project template (stages and rubric, not marks) for the next term or year. */
export async function copyTemplate(user: Actor, id: string, raw: unknown = {}) {
  need(user, 'exams.projects.manage');
  const input = CopySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const src = await tx.projectTemplate.findFirst({ where: { id, schoolId: user.schoolId }, include: templateInclude });
    if (!src) throw new ServiceError('Project not found', 404);
    const view = viewOf(src, false);
    const copy = await tx.projectTemplate.create({
      data: {
        schoolId: user.schoolId, title: input.title ?? `${src.title} (copy)`, subjectId: src.subjectId, levelId: src.levelId,
        startDate: input.startDate ? toDay(input.startDate) : null, dueDate: input.dueDate ? toDay(input.dueDate) : null,
        briefFileKey: src.briefFileKey, briefFileName: src.briefFileName, copiedFromId: src.id, createdById: user.id,
      },
    });
    await writeStages(tx, user.schoolId, copy.id, view.stages.map((s) => ({
      name: s.name, maxMark: s.rubric ? undefined : s.maxMark,
      rubric: s.rubric ? { criteria: s.rubric.criteria.map((c) => ({ name: c.name, levels: c.levels.map((l) => ({ label: l.label, descriptor: l.descriptor, marks: l.marks })) })) } : undefined,
    })));
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'COPY_PROJECT', entityType: 'ProjectTemplate', entityId: copy.id, detail: `Copied project ${src.title}` }, tx);
    return { id: copy.id };
  });
}

// ─── Starting a project in a class ───────────────────────────────────────────

const StartSchema = z.object({ templateId: idSchema, assignmentId: idSchema, title: z.string().trim().min(1).max(120).optional(), countsToTerm: z.boolean().default(true) });

async function projectType(tx: Db, schoolId: string) {
  await ensureDefaultTypes(tx, schoolId);
  const t = await tx.assessmentType.findFirst({ where: { schoolId, isProject: true, active: true }, orderBy: { sortOrder: 'asc' } });
  if (!t) throw new ServiceError('No assessment type is marked as a school-based project. Add one under Setup.', 409);
  return t;
}

/** A teacher starts a project for their own class from a template. Its marks are entered stage by stage. */
export async function startProject(user: Actor, raw: unknown) {
  const input = StartSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, input.assignmentId);
    assertOwnAssignment(user, a, 'exams.assessments.create');
    const tpl = await tx.projectTemplate.findFirst({ where: { id: input.templateId, schoolId: user.schoolId }, include: { stages: true } });
    if (!tpl || !tpl.active) throw new ServiceError('Project not found', 404);
    if (tpl.subjectId !== a.subjectId || tpl.levelId !== levelIdOf(a)) throw new ServiceError('This project is for a different subject or form', 422);
    if (await tx.assessment.findFirst({ where: { schoolId: user.schoolId, projectId: tpl.id, termId: a.termId, OR: [{ assignmentId: a.id }, { assignmentId: null }] } })) {
      throw new ServiceError('This project has already been started for this class this term', 409);
    }
    if (a.term.status === 'CLOSED') throw new ServiceError(`${a.term.name} is closed`, 409);
    const locked = await tx.markSheet.count({ where: { schoolId: user.schoolId, assignmentId: a.id, termId: a.termId, status: { in: ['SUBMITTED', 'VERIFIED', 'PUBLISHED'] } } });
    if (locked) throw new ServiceError('This mark sheet is locked. Ask the Head to unlock it before adding a project.', 409);
    const type = await projectType(tx, user.schoolId);
    const total = round2(tpl.stages.reduce((s, x) => s + num(x.maxMark)!, 0));
    const row = await tx.assessment.create({
      data: { schoolId: user.schoolId, termId: a.termId, assignmentId: a.id, levelId: tpl.levelId, subjectId: tpl.subjectId, typeId: type.id, projectId: tpl.id, title: input.title ?? tpl.title, date: tpl.dueDate, maxMark: total, countsToTerm: input.countsToTerm, createdById: user.id },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_ASSESSMENT', entityType: 'Assessment', entityId: row.id, detail: `Started project ${row.title} for ${a.subject.name} ${classNameOf(a)}` }, tx);
    return { id: row.id };
  });
}

const StartCommonSchema = z.object({ templateId: idSchema, termId: idSchema, countsToTerm: z.boolean().default(true) });

/** The Exams Officer starts a project once for every class of the subject at the level. */
export async function startCommonProject(user: Actor, raw: unknown) {
  need(user, 'exams.projects.manage');
  const input = StartCommonSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const tpl = await tx.projectTemplate.findFirst({ where: { id: input.templateId, schoolId: user.schoolId }, include: { stages: true } });
    if (!tpl || !tpl.active) throw new ServiceError('Project not found', 404);
    const term = await tx.academicTerm.findFirst({ where: { id: input.termId, schoolId: user.schoolId } });
    if (!term) throw new ServiceError('Term not found', 404);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    if (await tx.assessment.findFirst({ where: { schoolId: user.schoolId, projectId: tpl.id, termId: term.id, assignmentId: null } })) throw new ServiceError('This project has already been started for every class this term', 409);
    const type = await projectType(tx, user.schoolId);
    const total = round2(tpl.stages.reduce((s, x) => s + num(x.maxMark)!, 0));
    const row = await tx.assessment.create({
      data: { schoolId: user.schoolId, termId: term.id, levelId: tpl.levelId, subjectId: tpl.subjectId, typeId: type.id, projectId: tpl.id, title: tpl.title, date: tpl.dueDate, maxMark: total, countsToTerm: input.countsToTerm, createdById: user.id },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_ASSESSMENT', entityType: 'Assessment', entityId: row.id, detail: `Started project ${tpl.title} for every class, ${term.name}` }, tx);
    return { id: row.id };
  });
}

// ─── Rubric view ─────────────────────────────────────────────────────────────

export interface RubricView {
  stage: { id: string; name: string; maxMark: number };
  student: { id: string; name: string };
  criteria: { id: string; name: string; levels: { id: string; label: string; descriptor: string | null; marks: number }[]; chosenLevelId: string | null }[];
  total: number | null;
  complete: boolean;
  evidence: { id: string; fileName: string | null; contentType: string | null; at: string }[];
}

export async function rubricFor(user: Actor, assignmentId: string, assessmentId: string, stageId: string, studentId: string): Promise<RubricView> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    if (!holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.verify')) assertOwnAssignment(user, a, 'exams.marks.enter');
    const stage = await tx.projectStage.findFirst({
      where: { id: stageId, schoolId: user.schoolId, template: { assessments: { some: { id: assessmentId } } } },
      include: { rubric: { include: { criteria: { orderBy: { sortOrder: 'asc' }, include: { levels: { orderBy: { sortOrder: 'asc' } } } } } } },
    });
    if (!stage?.rubric) throw new ServiceError('This stage has no rubric', 404);
    const student = (await rosterOf(tx, user.schoolId, a)).find((s) => s.id === studentId);
    if (!student) throw new ServiceError('Student not found', 404);
    const mark = await tx.assessmentMark.findFirst({ where: { schoolId: user.schoolId, assignmentId, assessmentId, studentId, stageId }, include: { rubricScores: true, evidence: { orderBy: { createdAt: 'asc' } } } });
    const chosen = new Map((mark?.rubricScores ?? []).map((s) => [s.criterionId, s.levelId]));
    const criteria = stage.rubric.criteria.map((c) => ({ id: c.id, name: c.name, levels: c.levels.map((l) => ({ id: l.id, label: l.label, descriptor: l.descriptor, marks: num(l.marks)! })), chosenLevelId: chosen.get(c.id) ?? null }));
    const complete = criteria.every((c) => c.chosenLevelId);
    const total = criteria.reduce((sum, c) => sum + (c.levels.find((l) => l.id === c.chosenLevelId)?.marks ?? 0), 0);
    return {
      stage: { id: stage.id, name: stage.name, maxMark: num(stage.maxMark)! }, student: { id: student.id, name: `${student.surname.toUpperCase()}, ${student.firstName}` },
      criteria, total: complete ? round2(total) : null, complete,
      evidence: (mark?.evidence ?? []).map((e) => ({ id: e.id, fileName: e.fileName, contentType: e.contentType, at: e.createdAt.toISOString() })),
    };
  });
}

const ScoreSchema = z.object({
  assignmentId: idSchema, assessmentId: idSchema, stageId: idSchema, studentId: idSchema,
  scores: z.array(z.object({ criterionId: idSchema, levelId: idSchema })).min(1).max(12),
  reason: z.string().trim().max(300).nullish(),
});

/** The teacher clicks a level for each criterion; the total of the stage is calculated and saved as the stage mark. */
export async function scoreRubric(user: Actor, raw: unknown) {
  const input = ScoreSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { a, sheet } = await openForEntry(tx, user, input.assignmentId);
    const asm = await tx.assessment.findFirst({ where: { id: input.assessmentId, schoolId: user.schoolId, OR: [{ assignmentId: a.id }, { assignmentId: null }] }, select: { id: true, projectId: true } });
    if (!asm?.projectId) throw new ServiceError('This assessment is not a project', 404);
    const stage = await tx.projectStage.findFirst({
      where: { id: input.stageId, schoolId: user.schoolId, templateId: asm.projectId },
      include: { rubric: { include: { criteria: { include: { levels: true } } } } },
    });
    if (!stage?.rubric) throw new ServiceError('This stage has no rubric', 404);
    if (!(await rosterOf(tx, user.schoolId, a)).some((s) => s.id === input.studentId)) throw new ServiceError('This student does not take the subject in this class', 422);
    const criteria = stage.rubric.criteria;
    for (const s of input.scores) {
      const c = criteria.find((x) => x.id === s.criterionId);
      if (!c) throw new ServiceError('That criterion is not part of this stage', 422);
      if (!c.levels.some((l) => l.id === s.levelId)) throw new ServiceError('That level does not belong to the criterion', 422);
    }
    // The mark row the scores hang off (blank until every criterion has a level).
    await tx.assessmentMark.createMany({ data: [{ schoolId: user.schoolId, assessmentId: asm.id, assignmentId: a.id, studentId: input.studentId, stageId: stage.id, enteredById: user.id }], skipDuplicates: true });
    const mark = await tx.assessmentMark.findFirstOrThrow({ where: { schoolId: user.schoolId, assignmentId: a.id, assessmentId: asm.id, studentId: input.studentId, stageId: stage.id } });
    for (const s of input.scores) {
      await tx.rubricScore.upsert({ where: { markId_criterionId: { markId: mark.id, criterionId: s.criterionId } }, update: { levelId: s.levelId }, create: { schoolId: user.schoolId, markId: mark.id, criterionId: s.criterionId, levelId: s.levelId } });
    }
    const scores = await tx.rubricScore.findMany({ where: { markId: mark.id } });
    const complete = criteria.every((c) => scores.some((s) => s.criterionId === c.id));
    const total = complete ? round2(criteria.reduce((sum, c) => sum + num(c.levels.find((l) => l.id === scores.find((s) => s.criterionId === c.id)!.levelId)!.marks)!, 0)) : null;
    const result = await writeCells(tx, { user, a, sheet, reason: input.reason ?? null, fromRubric: true }, [{ studentId: input.studentId, assessmentId: asm.id, stageId: stage.id, value: total, code: null }]);
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ENTER_MARKS', entityType: 'AssessmentMark', entityId: mark.id, detail: `Rubric scored for ${stage.name}: ${total === null ? 'incomplete' : `${total} of ${num(stage.maxMark)}`}` }, tx);
    if (sheet.status === 'NOT_STARTED') await tx.markSheet.update({ where: { id: sheet.id }, data: { status: 'IN_PROGRESS' } });
    return { total, complete, outcome: result.outcomes[0]! };
  });
}

// ─── Evidence ────────────────────────────────────────────────────────────────


const EvidenceSchema = z.object({
  assignmentId: idSchema, assessmentId: idSchema, studentId: idSchema, stageId: idSchema.nullish(),
  fileKey: z.string().trim().min(10).max(200),
  fileName: z.string().trim().max(200).nullish(),
  contentType: z.enum(EVIDENCE_TYPES, { error: 'Upload a photo (JPG, PNG, WebP) or a PDF' }),
});

/** Attaches a photo or file to a student's project work (per stage), so moderation can see it. */
export async function addEvidence(user: Actor, raw: unknown) {
  const input = EvidenceSchema.parse(raw);
  if (!keyBelongs(input.fileKey, user.schoolId, 'mev')) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const { a } = await openForEntry(tx, user, input.assignmentId);
    const asm = await tx.assessment.findFirst({ where: { id: input.assessmentId, schoolId: user.schoolId, projectId: { not: null }, OR: [{ assignmentId: a.id }, { assignmentId: null }] }, select: { id: true, projectId: true } });
    if (!asm) throw new ServiceError('This assessment is not a project', 404);
    if (!input.stageId || !(await tx.projectStage.findFirst({ where: { id: input.stageId, schoolId: user.schoolId, templateId: asm.projectId! } }))) throw new ServiceError('Choose a stage of the project', 422);
    if (!(await rosterOf(tx, user.schoolId, a)).some((s) => s.id === input.studentId)) throw new ServiceError('This student does not take the subject in this class', 422);
    await tx.assessmentMark.createMany({ data: [{ schoolId: user.schoolId, assessmentId: asm.id, assignmentId: a.id, studentId: input.studentId, stageId: input.stageId, enteredById: user.id }], skipDuplicates: true });
    const mark = await tx.assessmentMark.findFirstOrThrow({ where: { schoolId: user.schoolId, assignmentId: a.id, assessmentId: asm.id, studentId: input.studentId, stageId: input.stageId } });
    const row = await tx.markEvidence.create({ data: { schoolId: user.schoolId, markId: mark.id, fileKey: input.fileKey, fileName: input.fileName ?? null, contentType: input.contentType, uploadedById: user.id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ADD_MARK_EVIDENCE', entityType: 'MarkEvidence', entityId: row.id, detail: `Evidence added for ${a.subject.name} ${classNameOf(a)}` }, tx);
    return { id: row.id };
  });
}

/** A link to an evidence file or a project brief that stops working after 10 minutes. Moderators (verifiers, Head) may open it too. */
export async function evidenceLink(user: Actor, evidenceId: string, sign: (key: string, expiresIn: string) => Promise<string> = signStudentFile) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.markEvidence.findFirst({ where: { id: evidenceId, schoolId: user.schoolId }, include: { mark: { select: { assignmentId: true } } } });
    if (!e || !keyBelongs(e.fileKey, user.schoolId, 'mev')) throw new ServiceError('File not found', 404);
    const a = await loadAssignment(tx, user.schoolId, e.mark.assignmentId);
    if (!holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.verify')) assertOwnAssignment(user, a, 'exams.marks.enter');
    return { url: await sign(e.fileKey, '10m'), expiresIn: '10m', fileName: e.fileName };
  });
}

export async function briefLink(user: Actor, templateId: string, sign: (key: string, expiresIn: string) => Promise<string> = signStudentFile) {
  if (!holds(user, 'exams.projects.manage') && !holds(user, 'exams.assessments.create')) throw new ServiceError('Forbidden', 403);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.projectTemplate.findFirst({ where: { id: templateId, schoolId: user.schoolId } });
    if (!t?.briefFileKey || !keyBelongs(t.briefFileKey, user.schoolId, 'mbf')) throw new ServiceError('This project has no brief', 404);
    return { url: await sign(t.briefFileKey, '10m'), expiresIn: '10m', fileName: t.briefFileName };
  });
}
