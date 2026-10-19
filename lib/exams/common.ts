// Small pieces every Examinations service uses: the settings row, the default assessment types, who may touch which
// teacher assignment, and who sits an assessment (the roster).
//
// Who can enter a mark comes from the teacher assignment (the teacher and the second teacher); who sits it comes from
// StudentSubject. Owner and Administrator ("*") reach everything, and the system records who did each step.
import { z } from 'zod';
import type { ExamSettings, MarkSheetStatus, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import { holds, isFull, type Actor } from '@/lib/academics/common';

export { holds, isFull };
export type { Actor };
export { idSchema, isoDateSchema, reasonSchema } from '@/lib/students/common';
export { resolveTerm, writableTerm, assertWritable, previousTerm, initialsOf, todayInHarare, toDay, isoOf } from '@/lib/academics/common';

/** Report-card and sheet comments fit on the card. */
export const MAX_COMMENT = 300;
export const commentSchema = z.string().trim().min(1, 'Write a comment').max(MAX_COMMENT, `Comments are limited to ${MAX_COMMENT} characters`);

/** The assessment types every school starts with; the school edits the list. */
export const DEFAULT_TYPES: { name: string; isProject: boolean; commonExam?: boolean }[] = [
  { name: 'Class test', isProject: false },
  { name: 'Assignment', isProject: false },
  { name: 'Practical', isProject: false },
  { name: 'Mid-term test', isProject: false },
  { name: 'End-of-term exam', isProject: false, commonExam: true },
  { name: 'Mock exam', isProject: false, commonExam: true },
  { name: 'School-based project', isProject: true },
  { name: 'Other', isProject: false },
];

/** A school's list of assessment types; made the first time anyone looks. */
export async function ensureDefaultTypes(tx: Db, schoolId: string) {
  if ((await tx.assessmentType.count({ where: { schoolId } })) === 0) {
    await tx.assessmentType.createMany({
      data: DEFAULT_TYPES.map((t, i) => ({ schoolId, name: t.name, isProject: t.isProject, commonExam: t.commonExam ?? false, sortOrder: i })),
      skipDuplicates: true,
    });
  }
}

export async function loadExamSettings(tx: Db, schoolId: string): Promise<ExamSettings> {
  const existing = await tx.examSettings.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return tx.examSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/** Prisma Decimal (or number, or null) as a number. */
export const num = (v: { toNumber(): number } | number | null | undefined): number | null => (v === null || v === undefined ? null : typeof v === 'number' ? v : v.toNumber());

// ─── Mark sheet states ───────────────────────────────────────────────────────

/** The sheet statuses in which the teacher may still change marks. */
export const EDITABLE: MarkSheetStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED', 'UNLOCKED'];
export const LOCKED: MarkSheetStatus[] = ['SUBMITTED', 'VERIFIED', 'PUBLISHED'];

export const STATUS_LABEL: Record<MarkSheetStatus, string> = {
  NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', VERIFIED: 'Verified',
  PUBLISHED: 'Published', RETURNED: 'Returned', UNLOCKED: 'Unlocked',
};

// ─── Assignments ─────────────────────────────────────────────────────────────

const assignmentInclude = {
  subject: { select: { id: true, name: true, shortName: true, code: true, departmentId: true } },
  class: { select: { id: true, name: true, levelId: true } },
  group: { select: { id: true, name: true, levelId: true } },
  teacher: { select: { id: true, fullName: true } },
  coTeacher: { select: { id: true, fullName: true } },
  term: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
} satisfies Prisma.TeacherAssignmentInclude;

export type LoadedAssignment = Prisma.TeacherAssignmentGetPayload<{ include: typeof assignmentInclude }>;

export async function loadAssignment(tx: Db, schoolId: string, id: string): Promise<LoadedAssignment> {
  const a = await tx.teacherAssignment.findFirst({ where: { id, schoolId }, include: assignmentInclude });
  if (!a) throw new ServiceError('Class not found', 404);
  return a;
}

export const levelIdOf = (a: LoadedAssignment): string => (a.class?.levelId ?? a.group?.levelId)!;
export const classNameOf = (a: LoadedAssignment): string => a.class?.name ?? a.group?.name ?? '';
export const isTeacherOf = (a: Pick<LoadedAssignment, 'teacherId' | 'coTeacherId'>, userId: string) => a.teacherId === userId || a.coTeacherId === userId;

/**
 * May this person act on this assignment's marks? Owner and Administrator may; others need the permission and must be the
 * teacher or second teacher. Anyone else is told the class was not found, so other teachers' classes are never revealed.
 */
export function assertOwnAssignment(user: Actor, a: Pick<LoadedAssignment, 'teacherId' | 'coTeacherId'>, permission: PermissionKey): void {
  if (isFull(user)) return;
  if (holds(user, permission) && isTeacherOf(a, user.id)) return;
  throw new ServiceError('Class not found', 404);
}

/** Marks are entered only under a live assignment; an ended one (the teacher was replaced) keeps what it recorded. */
export function assertLive(a: Pick<LoadedAssignment, 'status' | 'term'>): void {
  if (a.status !== 'ACTIVE') throw new ServiceError('This teaching assignment has ended, so its marks can no longer be changed here', 409);
  if (a.term.status === 'CLOSED') throw new ServiceError(`${a.term.name} is closed, so marks cannot be changed`, 409);
}

// ─── The roster ──────────────────────────────────────────────────────────────

export interface RosterStudent {
  id: string;
  admissionNumber: string;
  firstName: string;
  surname: string;
  fullName: string;
  gender: string | null;
  classId: string | null;
}

/**
 * Who sits the subject in this assignment: the students of the class (or teaching group) who take the subject this term
 * (StudentSubject), sorted by surname. Students who have left the class are not on it.
 */
export async function rosterOf(tx: Db, schoolId: string, a: LoadedAssignment): Promise<RosterStudent[]> {
  const takers = await tx.studentSubject.findMany({ where: { schoolId, termId: a.termId, subjectId: a.subjectId }, select: { studentId: true } });
  const takerIds = takers.map((t) => t.studentId);
  if (takerIds.length === 0) return [];
  const inClass = a.classId
    ? await tx.enrollment.findMany({ where: { schoolId, termId: a.termId, classId: a.classId, status: 'ACTIVE', studentId: { in: takerIds } }, select: { studentId: true, classId: true } })
    : (await tx.teachingGroupStudent.findMany({ where: { schoolId, groupId: a.groupId!, studentId: { in: takerIds } }, select: { studentId: true } })).map((s) => ({ studentId: s.studentId, classId: null as string | null }));
  const classOf = new Map(inClass.map((e) => [e.studentId, e.classId]));
  if (classOf.size === 0) return [];
  const students = await tx.student.findMany({
    where: { schoolId, id: { in: Array.from(classOf.keys()) } },
    select: { id: true, admissionNumber: true, firstName: true, surname: true, fullName: true, gender: true },
    orderBy: [{ surname: 'asc' }, { firstName: 'asc' }, { admissionNumber: 'asc' }],
  });
  return students.map((s) => ({ ...s, classId: classOf.get(s.id) ?? null }));
}

/** The assessments a teacher assignment marks: its own, and those set for every class of the subject at the level. */
export async function assessmentsOf(tx: Db, schoolId: string, a: LoadedAssignment) {
  return tx.assessment.findMany({
    where: { schoolId, termId: a.termId, subjectId: a.subjectId, levelId: levelIdOf(a), OR: [{ assignmentId: a.id }, { assignmentId: null }] },
    include: { type: { select: { id: true, name: true, isProject: true } }, project: { select: { id: true, title: true } }, topics: { select: { topicId: true } } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

/** The mark sheet of an assignment for its term, made when first needed. */
export async function ensureSheet(tx: Db, schoolId: string, a: Pick<LoadedAssignment, 'id' | 'termId'>) {
  const found = await tx.markSheet.findUnique({ where: { assignmentId_termId: { assignmentId: a.id, termId: a.termId } } });
  if (found) return found;
  await tx.markSheet.createMany({ data: [{ schoolId, assignmentId: a.id, termId: a.termId }], skipDuplicates: true });
  return tx.markSheet.findUniqueOrThrow({ where: { assignmentId_termId: { assignmentId: a.id, termId: a.termId } } });
}

/** Opens one transaction's worth of "Head correction" on the marks table (the database refuses changes to a locked sheet otherwise). */
export async function allowLockedMarkChanges(tx: Db): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.marks_unlock', '1', true)`;
}

export const nameOf = (s: { firstName: string; surname: string }) => `${s.surname.toUpperCase()}, ${s.firstName}`;
