// Assessment setup: the school's assessment types, the term weighting plans, the dates for entering and verifying marks, the
// examinations settings, the alternate verifier of each department and the comment bank.
//
// Each term the school decides what counts towards a subject's term mark and how much (a plan per level, optionally
// overridden for one subject); teachers then create the individual tests inside that plan.
import { z } from 'zod';
import type { CombineRule, CommentCategory } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { round2, validatePlan, type PlanLine } from '@/lib/results';
import { deputyIds, peopleWith } from '@/lib/academics/common';
import { commentSchema, ensureDefaultTypes, holds, idSchema, isoDateSchema, loadExamSettings, num, toDay, type Actor } from '@/lib/exams/common';

const need = (user: Actor, ...keys: Parameters<typeof holds>[1][]) => {
  if (!keys.some((k) => holds(user, k))) throw new ServiceError('Forbidden', 403);
};

const nameSchema = z.string().trim().min(1, 'Enter a name').max(60);

// ─── Assessment types ────────────────────────────────────────────────────────

export async function listTypes(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureDefaultTypes(tx, user.schoolId);
    const types = await tx.assessmentType.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { assessments: true, planTypes: true } } },
    });
    return types.map((t) => ({ id: t.id, name: t.name, isProject: t.isProject, commonExam: t.commonExam, active: t.active, sortOrder: t.sortOrder, assessments: t._count.assessments, inPlans: t._count.planTypes }));
  });
}

export const TypeSchema = z.object({ name: nameSchema, isProject: z.boolean().default(false), commonExam: z.boolean().default(false), active: z.boolean().default(true) });

const UpdateTypeSchema = z.object({ name: nameSchema.optional(), isProject: z.boolean().optional(), commonExam: z.boolean().optional(), active: z.boolean().optional() });

export async function createType(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage');
  const input = TypeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureDefaultTypes(tx, user.schoolId);
    if (await tx.assessmentType.findFirst({ where: { schoolId: user.schoolId, name: { equals: input.name, mode: 'insensitive' } } })) {
      throw new ServiceError(`There is already an assessment type called ${input.name}`, 409);
    }
    const max = await tx.assessmentType.aggregate({ where: { schoolId: user.schoolId }, _max: { sortOrder: true } });
    const t = await tx.assessmentType.create({ data: { schoolId: user.schoolId, name: input.name, isProject: input.isProject, commonExam: input.commonExam, active: input.active, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_ASSESSMENT_TYPE', entityType: 'AssessmentType', entityId: t.id, detail: `Added assessment type ${t.name}` }, tx);
    return { id: t.id };
  });
}

export async function updateType(user: Actor, id: string, raw: unknown) {
  need(user, 'exams.setup.manage');
  const input = UpdateTypeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const t = await tx.assessmentType.findFirst({ where: { id, schoolId: user.schoolId }, include: { _count: { select: { assessments: true } } } });
    if (!t) throw new ServiceError('Assessment type not found', 404);
    if (input.isProject !== undefined && input.isProject !== t.isProject && t._count.assessments > 0) {
      throw new ServiceError('This type is already used by assessments, so it cannot become (or stop being) a project', 409);
    }
    if (input.name && input.name.toLowerCase() !== t.name.toLowerCase()
      && (await tx.assessmentType.findFirst({ where: { schoolId: user.schoolId, id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } }))) {
      throw new ServiceError(`There is already an assessment type called ${input.name}`, 409);
    }
    await tx.assessmentType.update({ where: { id }, data: { name: input.name, isProject: input.isProject, commonExam: input.commonExam, active: input.active } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_ASSESSMENT_TYPE', entityType: 'AssessmentType', entityId: id, detail: `Changed assessment type ${t.name}${input.name && input.name !== t.name ? ` to ${input.name}` : ''}`, before: { name: t.name, active: t.active }, after: { name: input.name ?? t.name, active: input.active ?? t.active } }, tx);
    return { id };
  });
}

// ─── Weighting plans ─────────────────────────────────────────────────────────

export interface PlanView {
  id: string;
  termId: string;
  levelId: string;
  subjectId: string | null;
  name: string;
  lines: (PlanLine & { id: string })[];
}

const planInclude = { items: { orderBy: { sortOrder: 'asc' as const }, include: { types: { select: { typeId: true } } } } };
type PlanRow = { id: string; termId: string; levelId: string; subjectId: string | null; name: string; items: { id: string; label: string; weight: { toNumber(): number }; combineRule: CombineRule; bestN: number | null; types: { typeId: string }[] }[] };

const toView = (p: PlanRow): PlanView => ({
  id: p.id, termId: p.termId, levelId: p.levelId, subjectId: p.subjectId, name: p.name,
  lines: p.items.map((i) => ({ id: i.id, key: i.id, label: i.label, weight: i.weight.toNumber(), rule: i.combineRule, bestN: i.bestN, typeIds: i.types.map((t) => t.typeId) })),
});

/** The plan that governs a subject at a level in a term: the subject's own, else the level's. Null when there is none. */
export async function resolvePlan(tx: Db, schoolId: string, termId: string, levelId: string, subjectId: string): Promise<PlanView | null> {
  const own = await tx.weightingPlan.findFirst({ where: { schoolId, termId, levelId, subjectId }, include: planInclude });
  if (own) return toView(own);
  const level = await tx.weightingPlan.findFirst({ where: { schoolId, termId, levelId, subjectId: null }, include: planInclude });
  return level ? toView(level) : null;
}

export async function listPlans(user: Actor, termId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await tx.academicTerm.findFirst({ where: { id: termId, schoolId: user.schoolId } });
    if (!term) throw new ServiceError('Term not found', 404);
    const plans = await tx.weightingPlan.findMany({ where: { schoolId: user.schoolId, termId }, include: planInclude, orderBy: [{ level: { order: 'asc' } }, { createdAt: 'asc' }] });
    return plans.map(toView);
  });
}

const LineSchema = z.object({
  label: z.string().trim().min(1, 'Every line needs a name').max(80),
  weight: z.number().gt(0, 'The weight must be above 0').max(100).refine((w) => round2(w) === w, 'Use at most two decimal places'),
  rule: z.enum(['AVERAGE', 'BEST_N', 'BY_MAX']),
  bestN: z.number().int().min(1).max(20).nullish(),
  typeIds: z.array(idSchema).min(1, 'Choose at least one assessment type').max(8),
});

export const SavePlanSchema = z.object({
  termId: idSchema,
  levelId: idSchema,
  subjectId: idSchema.nullish(),
  name: z.string().trim().max(80).optional(),
  lines: z.array(LineSchema).min(1, 'A plan needs at least one line').max(8),
});

/** A plan cannot change under results that are already published for that level (and subject) and term. */
async function assertNoPublished(tx: Db, schoolId: string, termId: string, levelId: string, subjectId: string | null) {
  const n = await tx.subjectResult.count({ where: { schoolId, termId, levelId, published: true, ...(subjectId ? { subjectId } : {}) } });
  if (n > 0) throw new ServiceError('Results are already published for this level. Unpublish them before changing the plan.', 409);
}

/** Saves (replaces) the plan for a term and level, or for one subject at that level. */
export async function savePlan(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage');
  const input = SavePlanSchema.parse(raw);
  const problem = validatePlan(input.lines.map((l) => ({ label: l.label, weight: l.weight, rule: l.rule, bestN: l.bestN ?? null, typeIds: l.typeIds })));
  if (problem) throw new ServiceError(problem, 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const term = await tx.academicTerm.findFirst({ where: { id: input.termId, schoolId: sid } });
    if (!term) throw new ServiceError('Term not found', 404);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so its plan cannot be changed`, 409);
    const level = await tx.level.findFirst({ where: { id: input.levelId, schoolId: sid } });
    if (!level) throw new ServiceError('Level not found', 404);
    if (input.subjectId && !(await tx.subject.findFirst({ where: { id: input.subjectId, schoolId: sid } }))) throw new ServiceError('Subject not found', 404);
    const types = await tx.assessmentType.findMany({ where: { schoolId: sid, id: { in: input.lines.flatMap((l) => l.typeIds) } } });
    if (types.length !== new Set(input.lines.flatMap((l) => l.typeIds)).size) throw new ServiceError('Assessment type not found', 404);
    await assertNoPublished(tx, sid, input.termId, input.levelId, input.subjectId ?? null);

    const existing = await tx.weightingPlan.findFirst({ where: { schoolId: sid, termId: input.termId, levelId: input.levelId, subjectId: input.subjectId ?? null }, include: planInclude });
    const name = input.name || (input.subjectId ? 'Subject plan' : `${level.name} plan`);
    let planId: string;
    if (existing) {
      planId = existing.id;
      await tx.weightingPlanItemType.deleteMany({ where: { item: { planId } } });
      await tx.weightingPlanItem.deleteMany({ where: { planId } });
      await tx.weightingPlan.update({ where: { id: planId }, data: { name } });
    } else {
      planId = (await tx.weightingPlan.create({ data: { schoolId: sid, termId: input.termId, levelId: input.levelId, subjectId: input.subjectId ?? null, name, createdById: user.id } })).id;
    }
    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i]!;
      const item = await tx.weightingPlanItem.create({
        data: { schoolId: sid, planId, label: l.label, weight: l.weight, combineRule: l.rule, bestN: l.rule === 'BEST_N' ? l.bestN! : null, sortOrder: i },
      });
      await tx.weightingPlanItemType.createMany({ data: l.typeIds.map((typeId) => ({ schoolId: sid, itemId: item.id, typeId })) });
    }
    await logAudit({
      schoolId: sid, actorId: user.id, action: 'SAVE_WEIGHTING_PLAN', entityType: 'WeightingPlan', entityId: planId,
      detail: `${term.name}, ${level.name}${input.subjectId ? ' (one subject)' : ''}: ${input.lines.map((l) => `${l.label} ${l.weight}%`).join(', ')}`,
      before: existing ? { lines: toView(existing).lines.map((l) => `${l.label} ${l.weight}%`) } : undefined,
      after: { lines: input.lines.map((l) => `${l.label} ${l.weight}%`) },
    }, tx);
    return { id: planId };
  });
}

/** Removes a subject's own plan so the level's plan applies again. A level plan is replaced, not deleted. */
export async function removeSubjectPlan(user: Actor, planId: string) {
  need(user, 'exams.setup.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const p = await tx.weightingPlan.findFirst({ where: { id: planId, schoolId: user.schoolId } });
    if (!p) throw new ServiceError('Plan not found', 404);
    if (!p.subjectId) throw new ServiceError('A level plan cannot be removed. Save a different plan instead.', 409);
    await assertNoPublished(tx, user.schoolId, p.termId, p.levelId, p.subjectId);
    await tx.weightingPlanItemType.deleteMany({ where: { item: { planId } } });
    await tx.weightingPlanItem.deleteMany({ where: { planId } });
    await tx.weightingPlan.delete({ where: { id: planId } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_WEIGHTING_PLAN', entityType: 'WeightingPlan', entityId: planId, detail: 'Removed a subject plan; the level plan applies again' }, tx);
    return { id: planId };
  });
}

const CopyPlansSchema = z.object({ fromTermId: idSchema, toTermId: idSchema });

/** Copies every plan of one term to another (the weighting plan "can be copied to the next term or year"). Plans already there are kept. */
export async function copyPlans(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage');
  const input = CopyPlansSchema.parse(raw);
  if (input.fromTermId === input.toTermId) throw new ServiceError('Choose a different term to copy to', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const [from, to] = await Promise.all([
      tx.academicTerm.findFirst({ where: { id: input.fromTermId, schoolId: sid } }),
      tx.academicTerm.findFirst({ where: { id: input.toTermId, schoolId: sid } }),
    ]);
    if (!from || !to) throw new ServiceError('Term not found', 404);
    if (to.status === 'CLOSED') throw new ServiceError(`${to.name} is closed, so plans cannot be copied into it`, 409);
    const plans = await tx.weightingPlan.findMany({ where: { schoolId: sid, termId: from.id }, include: planInclude });
    let copied = 0;
    let skipped = 0;
    for (const p of plans) {
      if (await tx.weightingPlan.findFirst({ where: { schoolId: sid, termId: to.id, levelId: p.levelId, subjectId: p.subjectId } })) { skipped++; continue; }
      const made = await tx.weightingPlan.create({ data: { schoolId: sid, termId: to.id, levelId: p.levelId, subjectId: p.subjectId, name: p.name, createdById: user.id } });
      for (const i of p.items) {
        const item = await tx.weightingPlanItem.create({ data: { schoolId: sid, planId: made.id, label: i.label, weight: i.weight, combineRule: i.combineRule, bestN: i.bestN, sortOrder: i.sortOrder } });
        await tx.weightingPlanItemType.createMany({ data: i.types.map((t) => ({ schoolId: sid, itemId: item.id, typeId: t.typeId })) });
      }
      copied++;
    }
    await logAudit({ schoolId: sid, actorId: user.id, action: 'COPY_WEIGHTING_PLAN', entityType: 'WeightingPlan', entityId: to.id, detail: `Copied ${copied} plan(s) from ${from.name} to ${to.name}${skipped ? `; ${skipped} already there` : ''}` }, tx);
    return { copied, skipped };
  });
}

/**
 * The plan "Mock exam only" for a level: the whole term mark is the mock (Form 4 and Upper 6 in Term 3). A starting point
 * the Exams Officer saves with savePlan; nothing is stored until they do.
 */
export async function mockOnlyPlan(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureDefaultTypes(tx, user.schoolId);
    const mock = await tx.assessmentType.findFirst({ where: { schoolId: user.schoolId, name: 'Mock exam' } });
    return { lines: mock ? [{ label: 'Mock exam', weight: 100, rule: 'AVERAGE' as const, bestN: null, typeIds: [mock.id] }] : [] };
  });
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

const DeadlineSchema = z.object({
  termId: idSchema,
  entryDue: isoDateSchema.nullish(),
  submitDue: isoDateSchema.nullish(),
  verifyDue: isoDateSchema.nullish(),
});

export async function getDeadlines(user: Actor, termId: string) {
  const d = await getScopedDb(user.schoolId, user.id).examDeadline.findUnique({ where: { termId } });
  const iso = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null);
  return { termId, entryDue: iso(d?.entryDue), submitDue: iso(d?.submitDue), verifyDue: iso(d?.verifyDue) };
}

/** The Exams Officer sets the dates for mark entry, submission and verification each term. */
export async function setDeadlines(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage');
  const input = DeadlineSchema.parse(raw);
  const dates = [input.entryDue, input.submitDue, input.verifyDue].filter(Boolean) as string[];
  if (dates.some((d, i) => i > 0 && d < dates[i - 1]!)) throw new ServiceError('The dates must run in order: entry, then submission, then verification', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await tx.academicTerm.findFirst({ where: { id: input.termId, schoolId: user.schoolId } });
    if (!term) throw new ServiceError('Term not found', 404);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    const data = { entryDue: input.entryDue ? toDay(input.entryDue) : null, submitDue: input.submitDue ? toDay(input.submitDue) : null, verifyDue: input.verifyDue ? toDay(input.verifyDue) : null };
    await tx.examDeadline.upsert({ where: { termId: input.termId }, update: data, create: { schoolId: user.schoolId, termId: input.termId, ...data } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SET_EXAM_DEADLINES', entityType: 'ExamDeadline', entityId: input.termId, detail: `${term.name}: entry ${input.entryDue ?? '-'}, submission ${input.submitDue ?? '-'}, verification ${input.verifyDue ?? '-'}` }, tx);
    return { termId: input.termId };
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

export const ExamSettingsSchema = z.object({
  englishSubjectId: idSchema.nullish(),
  mathsSubjectId: idSchema.nullish(),
  passesRequired: z.number().int().min(1).max(20),
  outlierSd: z.number().gt(0).max(10),
  subjectCommentsEnabled: z.boolean(),
  showSubjectPositions: z.boolean(),
  showClassPosition: z.boolean(),
  showFormPosition: z.boolean(),
  showTypeScores: z.boolean(),
  showAttendance: z.boolean(),
  showConduct: z.boolean(),
  showPreviousAverage: z.boolean(),
}).partial();

export async function getExamSettings(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await loadExamSettings(tx, user.schoolId);
    const school = await tx.school.findUnique({ where: { id: user.schoolId }, select: { passGrade: true } });
    return { ...s, outlierSd: num(s.outlierSd)!, passGrade: school?.passGrade ?? 'C' };
  });
}

export async function saveExamSettings(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage', 'exams.reportcards.settings');
  const input = ExamSettingsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const before = await loadExamSettings(tx, user.schoolId);
    for (const key of ['englishSubjectId', 'mathsSubjectId'] as const) {
      const v = input[key];
      if (v && !(await tx.subject.findFirst({ where: { id: v, schoolId: user.schoolId } }))) throw new ServiceError('Subject not found', 404);
    }
    const after = await tx.examSettings.update({ where: { schoolId: user.schoolId }, data: input });
    const changed = Object.keys(input).filter((k) => String((before as never)[k]) !== String((after as never)[k]));
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_EXAM_SETTINGS', entityType: 'ExamSettings', entityId: after.id, detail: changed.length ? `Changed: ${changed.join(', ')}` : 'Saved, no change' }, tx);
    return { ...after, outlierSd: num(after.outlierSd)! };
  });
}

// ─── Alternate verifier ──────────────────────────────────────────────────────

/** Who verifies a department's sheets when its Head of Department is the teacher: another HOD or the Deputy. */
export async function setDepartmentVerifier(user: Actor, departmentId: string, userId: string | null) {
  need(user, 'exams.setup.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const dept = await tx.department.findFirst({ where: { id: departmentId, schoolId: user.schoolId } });
    if (!dept) throw new ServiceError('Department not found', 404);
    if (userId === null) {
      await tx.examDepartmentVerifier.deleteMany({ where: { departmentId } });
    } else {
      const eligible = new Set([...(await peopleWith(tx, user.schoolId, 'exams.marks.verify')), ...(await deputyIds(tx, user.schoolId))]);
      if (!eligible.has(userId)) throw new ServiceError('The alternate verifier must be another Head of Department or the Deputy', 422);
      if (userId === dept.hodUserId) throw new ServiceError('The alternate verifier must be someone other than the Head of Department', 422);
      await tx.examDepartmentVerifier.upsert({ where: { departmentId }, update: { userId }, create: { schoolId: user.schoolId, departmentId, userId } });
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SET_DEPARTMENT_VERIFIER', entityType: 'Department', entityId: departmentId, detail: userId ? `Set the alternate verifier of ${dept.name}` : `Removed the alternate verifier of ${dept.name}` }, tx);
    return { departmentId, userId };
  });
}

export async function verifierSetup(user: Actor) {
  const db = getScopedDb(user.schoolId, user.id);
  const [departments, set] = await Promise.all([
    db.department.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true, hodUserId: true, hod: { select: { fullName: true } } }, orderBy: { name: 'asc' } }),
    db.examDepartmentVerifier.findMany({ where: { schoolId: user.schoolId } }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: set.map((s) => s.userId) } }, select: { id: true, fullName: true } });
  const nameOfUser = new Map(people.map((p) => [p.id, p.fullName]));
  return departments.map((d) => {
    const v = set.find((s) => s.departmentId === d.id);
    return { departmentId: d.id, name: d.name, hod: d.hod?.fullName ?? null, verifierId: v?.userId ?? null, verifier: v ? nameOfUser.get(v.userId) ?? null : null };
  });
}

// ─── Comment bank ────────────────────────────────────────────────────────────

const BankSchema = z.object({ category: z.enum(['SUBJECT', 'CLASS_TEACHER', 'HEAD']), text: commentSchema });

export async function listCommentBank(user: Actor, category?: CommentCategory) {
  const rows = await getScopedDb(user.schoolId, user.id).commentBankItem.findMany({
    where: { schoolId: user.schoolId, ...(category ? { category } : {}) }, orderBy: [{ category: 'asc' }, { text: 'asc' }],
  });
  return rows.map((r) => ({ id: r.id, category: r.category, text: r.text }));
}

export async function addCommentBankItem(user: Actor, raw: unknown) {
  need(user, 'exams.setup.manage', 'exams.comments.head');
  const input = BankSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (await tx.commentBankItem.findFirst({ where: { schoolId: user.schoolId, category: input.category, text: input.text } })) throw new ServiceError('That phrase is already in the bank', 409);
    const row = await tx.commentBankItem.create({ data: { schoolId: user.schoolId, category: input.category, text: input.text } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_COMMENT_BANK', entityType: 'CommentBankItem', entityId: row.id, detail: `Added a ${input.category.toLowerCase().replace('_', ' ')} phrase` }, tx);
    return { id: row.id };
  });
}

export async function removeCommentBankItem(user: Actor, id: string) {
  need(user, 'exams.setup.manage', 'exams.comments.head');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const row = await tx.commentBankItem.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!row) throw new ServiceError('Phrase not found', 404);
    await tx.commentBankItem.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_COMMENT_BANK', entityType: 'CommentBankItem', entityId: id, detail: 'Removed a phrase from the comment bank' }, tx);
    return { id };
  });
}
