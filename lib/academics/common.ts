// Small pieces every Academics service uses: the term a request is about (and the rule that a closed term is
// read-only), the module settings, who a person is in the module (everything, or only their own classes), and the
// people who can approve something.
import { z } from 'zod';
import type { AcademicTerm, AcademicsSettings } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { heldAt, type AccessUser, type PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import { idSchema, isoDateSchema } from '@/lib/students/common';
import { todayInHarare } from '@/lib/students/registration';

export { idSchema, isoDateSchema, noteSchema, reasonSchema, addDays, approverIds } from '@/lib/students/common';
export { todayInHarare };

export type Actor = AccessUser & { fullName?: string; /** Keys of the roles the person holds (OWNER, HOD ...); present when the actor comes from a request. */ roles?: readonly string[] };

export const timeSchema = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM');
export const colourSchema = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour');

/** Whether the person holds the permission (at any scope). Nobody holds everything: the Owner and the Administrator hold the keys listed for them. */
export const holds = (user: AccessUser, permission: PermissionKey) => (user.grants ?? []).includes(permission);

export const toDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Monday = 1 ... Sunday = 7, for a YYYY-MM-DD date. */
export function weekdayOf(iso: string): number {
  const d = toDay(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

// ─── Terms ───────────────────────────────────────────────────────────────────

/** The term a request is about: the one given (it must be this school's) or else the open term. */
export async function resolveTerm(tx: Db, schoolId: string, termId?: string | null): Promise<AcademicTerm> {
  if (termId) {
    const t = await tx.academicTerm.findFirst({ where: { id: termId, schoolId } });
    if (!t) throw new ServiceError('Term not found', 404);
    return t;
  }
  const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
  if (!open) throw new ServiceError('No term is open. Open a term under Settings first.', 409);
  return open;
}

/** Closed terms are read-only. */
export function assertWritable(term: Pick<AcademicTerm, 'name' | 'status'>): void {
  if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so it cannot be changed`, 409);
}

export async function writableTerm(tx: Db, schoolId: string, termId?: string | null): Promise<AcademicTerm> {
  const term = await resolveTerm(tx, schoolId, termId);
  assertWritable(term);
  return term;
}

/** The term before this one (by start date), if the school has one. */
export async function previousTerm(tx: Db, schoolId: string, term: Pick<AcademicTerm, 'id' | 'startDate'>) {
  return tx.academicTerm.findFirst({ where: { schoolId, startDate: { lt: term.startDate }, id: { not: term.id } }, orderBy: { startDate: 'desc' } });
}

// ─── Settings ────────────────────────────────────────────────────────────────

/** The module settings of the school; the row is made the first time anyone needs it. */
export async function loadSettings(tx: Db, schoolId: string): Promise<AcademicsSettings> {
  const existing = await tx.academicsSettings.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return tx.academicsSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
}

/** Forms 1-4 are O Level, Forms 5-6 A Level. */
export const bandOf = (levelOrder: number): 'O' | 'A' => (levelOrder >= 5 ? 'A' : 'O');

export function subjectLimits(s: AcademicsSettings, levelOrder: number) {
  return bandOf(levelOrder) === 'A'
    ? { min: s.minSubjectsALevel, max: s.maxSubjectsALevel }
    : { min: s.minSubjectsOLevel, max: s.maxSubjectsOLevel };
}

// ─── People ──────────────────────────────────────────────────────────────────

/** "Tendai Chikore" → "TC". Titles (Mr, Mrs, Dr ...) are not initials. */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((p) => !/^(mr|mrs|ms|miss|dr|prof|rev|sir|madam)\.?$/i.test(p));
  return parts.map((p) => p[0]!.toUpperCase()).join('').slice(0, 3) || '?';
}

/** An active member of staff with the TEACHER role. Throws the reason when the person cannot be given lessons. */
export async function requireTeacher(tx: Db, schoolId: string, userId: string, label = 'The teacher') {
  const u = await tx.user.findFirst({
    where: { id: userId, schoolId, isSupport: false },
    select: { id: true, fullName: true, active: true, userRoles: { select: { role: { select: { key: true } } } } },
  });
  if (!u) throw new ServiceError(`${label} was not found`, 404);
  if (!u.active) throw new ServiceError(`${u.fullName} is not an active user`, 409);
  if (!u.userRoles.some((r) => r.role.key === 'TEACHER')) throw new ServiceError(`${u.fullName} does not have the Teacher role, so cannot be given lessons`, 409);
  return u;
}

/** Active people whose roles grant `permission`. */
export async function peopleWith(tx: Db, schoolId: string, permission: PermissionKey, exceptUserId?: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: {
      schoolId, active: true, isSupport: false, ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      userRoles: { some: { role: { permissions: { some: { permissionKey: permission } } } } },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Deputy heads of the school (they get attendance alerts and run the timetable). */
export async function deputyIds(tx: Db, schoolId: string): Promise<string[]> {
  const rows = await tx.user.findMany({
    where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: 'DEPUTY_HEAD' } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ─── What a person without "*" may reach ─────────────────────────────────────

export interface OwnScope {
  /** Classes the person is class teacher of in the term. */
  classTeacherOf: string[];
  /** Classes they teach a subject to (a teaching group counts through its students' classes). */
  taughtClasses: string[];
  /** Their live assignments (as teacher or second teacher). */
  assignmentIds: string[];
  /** Departments they head. */
  departmentIds: string[];
}

/** The classes, assignments and departments a teacher reaches in a term. Everything else is hidden from them. */
export async function ownScope(tx: Db, user: AccessUser, termId: string): Promise<OwnScope> {
  const [ct, assignments, depts] = await Promise.all([
    tx.classTeacher.findMany({ where: { termId, userId: user.id }, select: { classId: true } }),
    tx.teacherAssignment.findMany({
      where: { termId, status: 'ACTIVE', OR: [{ teacherId: user.id }, { coTeacherId: user.id }] },
      select: { id: true, classId: true, groupId: true },
    }),
    tx.department.findMany({ where: { hodUserId: user.id }, select: { id: true } }),
  ]);
  const groupIds = assignments.map((a) => a.groupId).filter((x): x is string => !!x);
  let groupClasses: string[] = [];
  if (groupIds.length) {
    const rows = await tx.enrollment.findMany({
      where: { termId, status: 'ACTIVE', student: { teachingGroups: { some: { groupId: { in: groupIds } } } } },
      select: { classId: true },
      distinct: ['classId'],
    });
    groupClasses = rows.map((r) => r.classId);
  }
  const direct = assignments.map((a) => a.classId).filter((x): x is string => !!x);
  return {
    classTeacherOf: ct.map((c) => c.classId),
    taughtClasses: Array.from(new Set([...direct, ...groupClasses])),
    assignmentIds: assignments.map((a) => a.id),
    departmentIds: depts.map((d) => d.id),
  };
}

/**
 * Whether a person looks after the whole school's classes rather than only their own: the administrator, anyone who runs classes
 * (classes.manage) or corrects registers, and anyone who holds classes.view for the whole school (a Deputy, a Registrar), as against a teacher,
 * who holds it for the classes they teach.
 */
export function seesAllClasses(user: Actor | AccessUser): boolean {
  return holds(user, 'academics.classes.manage') || holds(user, 'academics.attendance.correct') || heldAt(user, 'academics.classes.view', 'SCHOOL');
}

/** The same for registers: the Deputy (who corrects them) and non-teaching viewers see every class; a class teacher only their own. */
export function seesAllRegisters(user: Actor | AccessUser): boolean {
  return holds(user, 'academics.attendance.correct') || heldAt(user, 'academics.attendance.view', 'SCHOOL');
}

/** The classes a person may see in the classes list: all for the administrator and the Deputy, else the ones they are class teacher of or teach. */
export async function reachableClassIds(tx: Db, user: AccessUser, termId: string): Promise<'all' | string[]> {
  if (seesAllClasses(user)) return 'all';
  const s = await ownScope(tx, user, termId);
  return Array.from(new Set([...s.classTeacherOf, ...s.taughtClasses]));
}

/** A class the person may not reach is reported as not found, so other classes are never revealed. */
export async function assertClassReachable(tx: Db, user: AccessUser, classId: string, termId: string): Promise<void> {
  if (!(await tx.schoolClass.findFirst({ where: { id: classId }, select: { id: true } }))) throw new ServiceError('Class not found', 404);
  const r = await reachableClassIds(tx, user, termId);
  if (r !== 'all' && !r.includes(classId)) throw new ServiceError('Class not found', 404);
}

/** The timetable being worked on (draft or waiting for approval), else the published one. */
export async function currentTimetableId(tx: Db, termId: string): Promise<string | null> {
  const t = (await tx.timetable.findFirst({ where: { termId, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } })) ?? (await tx.timetable.findFirst({ where: { termId, status: 'PUBLISHED' }, select: { id: true } }));
  return t?.id ?? null;
}

export function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export const termIdQuery = z.object({ termId: idSchema.optional() });
export const dateOrToday = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayInHarare());
export { isoDateSchema as isoDate };
