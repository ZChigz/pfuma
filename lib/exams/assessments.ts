// Assessments: the individual tests, assignments, practicals and exams inside the term's plan.
//
//  • A teacher creates the tests of their own teaching assignments (title, type, date, maximum mark, whether it counts
//    towards the term mark, optional syllabus topics).
//  • End-of-term exams and mocks are created once by the Exams Officer for every subject at a level, so all classes write
//    the same paper with the same maximum mark. They belong to no one assignment.
//  • An assessment with marks cannot change its maximum mark: it is copied and the marks entered again (the database
//    refuses the change too).
//  • Nothing is added or changed on a mark sheet that is submitted, verified or published; the Head opens it first.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { round2 } from '@/lib/results';
import {
  LOCKED, assertLive, assertOwnAssignment, assessmentsOf, ensureDefaultTypes, holds, idSchema, isoDateSchema, levelIdOf, loadAssignment,
  num, toDay, type Actor,
} from '@/lib/exams/common';

const maxMarkSchema = z.number().gt(0, 'The maximum mark must be above 0').max(1000).refine((n) => round2(n) === n, 'Use at most two decimal places');
const titleSchema = z.string().trim().min(1, 'Give the assessment a title').max(120);

export const CreateAssessmentSchema = z.object({
  assignmentId: idSchema,
  typeId: idSchema,
  title: titleSchema,
  date: isoDateSchema.nullish(),
  maxMark: maxMarkSchema,
  countsToTerm: z.boolean().default(true),
  topicIds: z.array(idSchema).max(30).default([]),
});

export const CreateCommonSchema = z.object({
  termId: idSchema,
  levelId: idSchema,
  /** Subjects to set the paper for; leave out for every subject offered at the level. */
  subjectIds: z.array(idSchema).max(60).optional(),
  typeId: idSchema,
  title: titleSchema,
  date: isoDateSchema.nullish(),
  maxMark: maxMarkSchema,
  countsToTerm: z.boolean().default(true),
});

export const UpdateAssessmentSchema = z.object({
  title: titleSchema.optional(),
  date: isoDateSchema.nullish(),
  maxMark: maxMarkSchema.optional(),
  countsToTerm: z.boolean().optional(),
  topicIds: z.array(idSchema).max(30).optional(),
});

export const CopyAssessmentSchema = z.object({
  title: titleSchema.optional(),
  maxMark: maxMarkSchema,
  /** The original stops counting towards the term mark (it is replaced). */
  replace: z.boolean().default(true),
});

export interface AssessmentView {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  isProject: boolean;
  projectId: string | null;
  date: string | null;
  maxMark: number;
  countsToTerm: boolean;
  common: boolean;
  topicIds: string[];
  hasMarks: boolean;
}

async function viewsOf(tx: Db, schoolId: string, rows: Awaited<ReturnType<typeof assessmentsOf>>): Promise<AssessmentView[]> {
  const withMarks = rows.length
    ? await tx.assessmentMark.groupBy({ by: ['assessmentId'], where: { schoolId, assessmentId: { in: rows.map((r) => r.id) }, OR: [{ value: { not: null } }, { code: { not: null } }] } })
    : [];
  const has = new Set(withMarks.map((m) => m.assessmentId));
  return rows.map((r) => ({
    id: r.id, title: r.title, typeId: r.typeId, typeName: r.type.name, isProject: r.type.isProject, projectId: r.projectId,
    date: r.date ? r.date.toISOString().slice(0, 10) : null, maxMark: num(r.maxMark)!, countsToTerm: r.countsToTerm,
    common: r.assignmentId === null, topicIds: r.topics.map((t) => t.topicId), hasMarks: has.has(r.id),
  }));
}

/** The assessments of one teaching assignment: its own and the common ones. */
export async function listAssessments(user: Actor, assignmentId: string): Promise<AssessmentView[]> {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, assignmentId);
    if (!holds(user, 'exams.marks.view') && !holds(user, 'exams.marks.verify')) assertOwnAssignment(user, a, 'exams.marks.enter');
    return viewsOf(tx, user.schoolId, await assessmentsOf(tx, user.schoolId, a));
  });
}

/** Sheets that are submitted, verified or published, which marks (and the list of assessments) must not change under. */
async function lockedSheets(tx: Db, schoolId: string, where: { termId: string; assignmentId?: string | null; subjectId: string; levelId: string }) {
  return tx.markSheet.findMany({
    where: {
      schoolId, termId: where.termId, status: { in: LOCKED },
      assignment: where.assignmentId ? { id: where.assignmentId } : { subjectId: where.subjectId, OR: [{ class: { levelId: where.levelId } }, { group: { levelId: where.levelId } }] },
    },
    select: { id: true, status: true },
  });
}

const lockedMessage = (n: number) => (n === 1 ? 'This mark sheet is locked' : `${n} mark sheets are locked`) + '. Ask the Head to unlock it before changing the assessments.';

async function checkTopics(tx: Db, schoolId: string, topicIds: string[], subjectId: string, levelId: string) {
  if (topicIds.length === 0) return;
  const found = await tx.syllabusTopic.count({ where: { schoolId, id: { in: topicIds }, subjectId, levelId } });
  if (found !== new Set(topicIds).size) throw new ServiceError('A topic does not belong to this subject and level', 422);
}

async function loadType(tx: Db, schoolId: string, typeId: string) {
  await ensureDefaultTypes(tx, schoolId);
  const t = await tx.assessmentType.findFirst({ where: { id: typeId, schoolId } });
  if (!t) throw new ServiceError('Assessment type not found', 404);
  if (!t.active) throw new ServiceError(`${t.name} is switched off`, 409);
  return t;
}

/** A teacher adds a test, assignment, practical or similar to their own class. */
export async function createAssessment(user: Actor, raw: unknown) {
  const input = CreateAssessmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await loadAssignment(tx, user.schoolId, input.assignmentId);
    assertOwnAssignment(user, a, 'exams.assessments.create');
    assertLive(a);
    const type = await loadType(tx, user.schoolId, input.typeId);
    if (type.isProject) throw new ServiceError('Start a school-based project from the Projects page', 422);
    if (type.commonExam) throw new ServiceError(`${type.name} papers are set once by the Exams Officer for every class`, 403);
    const locked = await lockedSheets(tx, user.schoolId, { termId: a.termId, assignmentId: a.id, subjectId: a.subjectId, levelId: levelIdOf(a) });
    if (locked.length) throw new ServiceError(lockedMessage(locked.length), 409);
    await checkTopics(tx, user.schoolId, input.topicIds, a.subjectId, levelIdOf(a));
    const row = await tx.assessment.create({
      data: {
        schoolId: user.schoolId, termId: a.termId, assignmentId: a.id, levelId: levelIdOf(a), subjectId: a.subjectId, typeId: type.id, title: input.title,
        date: input.date ? toDay(input.date) : null, maxMark: input.maxMark, countsToTerm: input.countsToTerm, createdById: user.id,
        topics: { create: Array.from(new Set(input.topicIds)).map((topicId) => ({ schoolId: user.schoolId, topicId })) },
      },
    });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_ASSESSMENT', entityType: 'Assessment', entityId: row.id, detail: `${input.title} (${type.name}, out of ${input.maxMark}) for ${a.subject.name} ${a.class?.name ?? a.group?.name}` }, tx);
    return { id: row.id };
  });
}

/** The Exams Officer sets one paper for every subject and class at a level. Subjects that already have it are skipped. */
export async function createCommonAssessments(user: Actor, raw: unknown) {
  if (!holds(user, 'exams.setup.manage')) throw new ServiceError('Forbidden', 403);
  const input = CreateCommonSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const [term, level] = await Promise.all([
      tx.academicTerm.findFirst({ where: { id: input.termId, schoolId: sid } }),
      tx.level.findFirst({ where: { id: input.levelId, schoolId: sid } }),
    ]);
    if (!term) throw new ServiceError('Term not found', 404);
    if (!level) throw new ServiceError('Level not found', 404);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed`, 409);
    const type = await loadType(tx, sid, input.typeId);
    if (type.isProject) throw new ServiceError('Projects are started from the Projects page', 422);

    const offered = await tx.subjectLevel.findMany({ where: { schoolId: sid, levelId: level.id, subject: { active: true } }, select: { subjectId: true } });
    const taught = await tx.teacherAssignment.findMany({
      where: { schoolId: sid, termId: term.id, status: 'ACTIVE', OR: [{ class: { levelId: level.id } }, { group: { levelId: level.id } }] },
      select: { subjectId: true },
    });
    const available = new Set([...offered.map((o) => o.subjectId), ...taught.map((t) => t.subjectId)]);
    const subjectIds = input.subjectIds?.length ? Array.from(new Set(input.subjectIds)) : Array.from(available);
    if (subjectIds.some((id) => !available.has(id))) throw new ServiceError('A subject is not offered at this level', 422);
    if (subjectIds.length === 0) throw new ServiceError(`No subjects are offered at ${level.name} yet`, 409);

    let created = 0;
    const skipped: string[] = [];
    const blocked: string[] = [];
    for (const subjectId of subjectIds) {
      if (await tx.assessment.findFirst({ where: { schoolId: sid, termId: term.id, levelId: level.id, subjectId, assignmentId: null, typeId: type.id, title: input.title } })) {
        skipped.push(subjectId);
        continue;
      }
      if ((await lockedSheets(tx, sid, { termId: term.id, subjectId, levelId: level.id })).length) { blocked.push(subjectId); continue; }
      await tx.assessment.create({
        data: { schoolId: sid, termId: term.id, levelId: level.id, subjectId, typeId: type.id, title: input.title, date: input.date ? toDay(input.date) : null, maxMark: input.maxMark, countsToTerm: input.countsToTerm, createdById: user.id },
      });
      created++;
    }
    if (blocked.length) throw new ServiceError(`${blocked.length} subject(s) already have submitted or verified mark sheets. Ask the Head to unlock them first.`, 409);
    await logAudit({ schoolId: sid, actorId: user.id, action: 'CREATE_ASSESSMENT', entityType: 'Assessment', entityId: level.id, detail: `${input.title} (${type.name}, out of ${input.maxMark}) set for ${created} subject(s) at ${level.name}, ${term.name}${skipped.length ? `; ${skipped.length} already had it` : ''}` }, tx);
    return { created, skipped: skipped.length };
  });
}

/** May this person change this assessment? A common one: setup.manage. A private one: the teacher of its assignment. */
async function loadForChange(tx: Db, user: Actor, id: string, permission: 'exams.assessments.create') {
  const row = await tx.assessment.findFirst({ where: { id, schoolId: user.schoolId }, include: { type: true, assignment: true, term: { select: { name: true, status: true } } } });
  if (!row) throw new ServiceError('Assessment not found', 404);
  if (row.term.status === 'CLOSED') throw new ServiceError(`${row.term.name} is closed`, 409);
  if (row.assignmentId === null) {
    if (!holds(user, 'exams.setup.manage')) throw new ServiceError('Only the Exams Officer can change a paper set for every class', 403);
  } else if (!(holds(user, permission) && (row.assignment!.teacherId === user.id || row.assignment!.coTeacherId === user.id))) {
    throw new ServiceError('Assessment not found', 404);
  }
  return row;
}

export async function updateAssessment(user: Actor, id: string, raw: unknown) {
  const input = UpdateAssessmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const row = await loadForChange(tx, user, id, 'exams.assessments.create');
    const marks = await tx.assessmentMark.count({ where: { assessmentId: id, OR: [{ value: { not: null } }, { code: { not: null } }] } });
    const maxChanged = input.maxMark !== undefined && round2(input.maxMark) !== num(row.maxMark);
    if (maxChanged && marks > 0) throw new ServiceError('Marks have been entered, so the maximum mark cannot change. Copy the assessment instead and enter the marks again.', 409);
    const countsChanged = input.countsToTerm !== undefined && input.countsToTerm !== row.countsToTerm;
    if (maxChanged || countsChanged) {
      const locked = await lockedSheets(tx, user.schoolId, { termId: row.termId, assignmentId: row.assignmentId, subjectId: row.subjectId, levelId: row.levelId });
      if (locked.length) throw new ServiceError(lockedMessage(locked.length), 409);
    }
    if (input.topicIds) await checkTopics(tx, user.schoolId, input.topicIds, row.subjectId, row.levelId);
    await tx.assessment.update({
      where: { id },
      data: {
        title: input.title, countsToTerm: input.countsToTerm, ...(maxChanged ? { maxMark: input.maxMark } : {}),
        ...(input.date !== undefined ? { date: input.date ? toDay(input.date) : null } : {}),
      },
    });
    if (input.topicIds) {
      await tx.assessmentTopic.deleteMany({ where: { assessmentId: id } });
      await tx.assessmentTopic.createMany({ data: Array.from(new Set(input.topicIds)).map((topicId) => ({ schoolId: user.schoolId, assessmentId: id, topicId })) });
    }
    await logAudit({
      schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_ASSESSMENT', entityType: 'Assessment', entityId: id,
      detail: `Changed ${row.title}`,
      before: { title: row.title, maxMark: num(row.maxMark), countsToTerm: row.countsToTerm },
      after: { title: input.title ?? row.title, maxMark: maxChanged ? input.maxMark! : num(row.maxMark), countsToTerm: input.countsToTerm ?? row.countsToTerm },
    }, tx);
    return { id };
  });
}

/**
 * Copies an assessment with a new maximum mark, for when marks already exist and the maximum was wrong. The copy starts
 * empty; by default the original stops counting towards the term mark so nothing is counted twice.
 */
export async function copyAssessment(user: Actor, id: string, raw: unknown) {
  const input = CopyAssessmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const row = await loadForChange(tx, user, id, 'exams.assessments.create');
    if (row.type.isProject) throw new ServiceError('Projects are copied from the Projects page', 422);
    const locked = await lockedSheets(tx, user.schoolId, { termId: row.termId, assignmentId: row.assignmentId, subjectId: row.subjectId, levelId: row.levelId });
    if (locked.length) throw new ServiceError(lockedMessage(locked.length), 409);
    const topics = await tx.assessmentTopic.findMany({ where: { assessmentId: id }, select: { topicId: true } });
    const copy = await tx.assessment.create({
      data: {
        schoolId: user.schoolId, termId: row.termId, assignmentId: row.assignmentId, levelId: row.levelId, subjectId: row.subjectId, typeId: row.typeId,
        title: input.title ?? `${row.title} (copy)`, date: row.date, maxMark: input.maxMark, countsToTerm: row.countsToTerm, copiedFromId: row.id, createdById: user.id,
        topics: { create: topics.map((t) => ({ schoolId: user.schoolId, topicId: t.topicId })) },
      },
    });
    if (input.replace && row.countsToTerm) await tx.assessment.update({ where: { id }, data: { countsToTerm: false } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'COPY_ASSESSMENT', entityType: 'Assessment', entityId: copy.id, detail: `Copied ${row.title} (out of ${num(row.maxMark)}) as ${copy.title} (out of ${input.maxMark})${input.replace ? '; the original no longer counts' : ''}` }, tx);
    return { id: copy.id };
  });
}

/** An assessment with no marks at all can be removed (one made by mistake). Marks themselves are never deleted. */
export async function deleteAssessment(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const row = await loadForChange(tx, user, id, 'exams.assessments.create');
    if (await tx.assessmentMark.count({ where: { assessmentId: id } })) throw new ServiceError('Marks have been entered for this assessment, so it cannot be removed. Marks are never deleted.', 409);
    if (row.projectId) throw new ServiceError('Remove a project from the Projects page', 422);
    await tx.assessmentTopic.deleteMany({ where: { assessmentId: id } });
    await tx.assessment.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_ASSESSMENT', entityType: 'Assessment', entityId: id, detail: `Removed ${row.title}, which had no marks` }, tx);
    return { id };
  });
}
