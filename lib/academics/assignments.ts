// Teacher assignments: one teacher teaches one subject to one class (or teaching group) in one term for a number of
// periods a week. This is the hub of the module: the timetable, schemes of work and marks hang off these rows.
//
// Rules kept here (and, where a database can, by indexes and checks):
//  • the teacher is an active user with the TEACHER role; the subject is active and offered at the class's form;
//  • one live assignment per term, subject and class/group;
//  • a teacher changed mid-term ENDS the old assignment on a date and starts a new one, so what was already recorded
//    keeps its teacher;
//  • the term's whole set goes to the Head for approval; after approval the administrator can still fix single
//    assignments, and every change is logged;
//  • a closed term cannot be changed.
// Class assignments are mirrored into SubjectAssignment, which the marks pages (Examinations) still use.
import { z } from 'zod';
import type { Prisma, TeacherAssignment } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import {
  addDays, currentTimetableId, dedupe, holds, idSchema, initialsOf, isFull, isoDateSchema, isoOf, loadSettings, noteSchema,
  ownScope, peopleWith, requireTeacher, resolveTerm, todayInHarare, toDay, writableTerm, type Actor,
} from '@/lib/academics/common';
import { classSubjects, findGaps } from '@/lib/academics/coverage';

const periods = z.number().int().min(1, 'At least 1 period a week').max(40, 'At most 40 periods a week');
const doubles = z.number().int().min(0).max(20);

export const AssignmentSchema = z
  .object({
    termId: idSchema.optional(),
    teacherId: idSchema,
    coTeacherId: idSchema.nullable().optional(),
    subjectId: idSchema,
    classId: idSchema.nullable().optional(),
    groupId: idSchema.nullable().optional(),
    periodsPerWeek: periods,
    doublesPerWeek: doubles.default(0),
    startDate: isoDateSchema.optional(),
  })
  .refine((a) => !!a.classId !== !!a.groupId, { path: ['classId'], message: 'Choose a class or a teaching group (not both)' })
  .refine((a) => a.doublesPerWeek * 2 <= a.periodsPerWeek, { path: ['doublesPerWeek'], message: 'Double periods use two periods each, so they cannot be more than half the periods' })
  .refine((a) => !a.coTeacherId || a.coTeacherId !== a.teacherId, { path: ['coTeacherId'], message: 'The second teacher must be someone else' });
export type AssignmentInput = z.input<typeof AssignmentSchema>;

type TeacherRef = { id: string; fullName: string };

// ─── The mirror in SubjectAssignment (marks entry) ───────────────────────────

async function mirrorToMarks(tx: Db, schoolId: string, a: Pick<TeacherAssignment, 'termId' | 'subjectId' | 'classId' | 'teacherId'>) {
  if (!a.classId) return;
  await tx.subjectAssignment.upsert({
    where: { subjectId_classId_termId: { subjectId: a.subjectId, classId: a.classId, termId: a.termId } },
    update: { teacherId: a.teacherId },
    create: { schoolId, teacherId: a.teacherId, subjectId: a.subjectId, classId: a.classId, termId: a.termId },
  });
}

async function unmirror(tx: Db, a: Pick<TeacherAssignment, 'termId' | 'subjectId' | 'classId'>) {
  if (!a.classId) return;
  // Once marks have been entered the row stays: the marks pages need it.
  await tx.subjectAssignment.deleteMany({ where: { subjectId: a.subjectId, classId: a.classId, termId: a.termId, marksStatus: 'NOT_STARTED' } });
}

// ─── Loading ─────────────────────────────────────────────────────────────────

async function loadContext(tx: Db, schoolId: string, input: { subjectId: string; classId?: string | null; groupId?: string | null }) {
  const subject = await tx.subject.findFirst({ where: { id: input.subjectId } });
  if (!subject) throw new ServiceError('Subject not found', 404);
  if (!subject.active) throw new ServiceError(`${subject.name} is inactive, so it cannot be assigned`, 409);
  let levelId: string, levelName: string, target: { id: string; name: string };
  if (input.classId) {
    const c = await tx.schoolClass.findFirst({ where: { id: input.classId }, include: { level: true } });
    if (!c) throw new ServiceError('Class not found', 404);
    if (!c.active || !c.level.active) throw new ServiceError(`${c.name} is not in use`, 409);
    levelId = c.levelId; levelName = c.level.name; target = { id: c.id, name: c.name };
  } else {
    const g = await tx.teachingGroup.findFirst({ where: { id: input.groupId! }, include: { level: true } });
    if (!g) throw new ServiceError('Teaching group not found', 404);
    if (g.subjectId !== subject.id) throw new ServiceError(`${g.name} is a group for another subject`, 422);
    levelId = g.levelId; levelName = g.level.name; target = { id: g.id, name: g.name };
  }
  const offered = await tx.subjectLevel.findFirst({ where: { subjectId: subject.id, levelId } });
  if (!offered) throw new ServiceError(`${subject.name} is not offered in ${levelName}`, 422);
  return { subject, levelId, levelName, target };
}

/** Periods a week a teacher has in a term (as teacher or second teacher). */
async function teacherPeriods(tx: Db, termId: string, userId: string, exceptAssignmentId?: string): Promise<number> {
  const rows = await tx.teacherAssignment.findMany({
    where: { termId, status: 'ACTIVE', OR: [{ teacherId: userId }, { coTeacherId: userId }], ...(exceptAssignmentId ? { id: { not: exceptAssignmentId } } : {}) },
    select: { periodsPerWeek: true },
  });
  return rows.reduce((s, r) => s + r.periodsPerWeek, 0);
}

async function loadWarnings(tx: Db, schoolId: string, termId: string, users: (TeacherRef | null)[], addPeriods: number, exceptAssignmentId?: string) {
  const { maxPeriodsPerWeek } = await loadSettings(tx, schoolId);
  const out: string[] = [];
  for (const u of users) {
    if (!u) continue;
    const total = (await teacherPeriods(tx, termId, u.id, exceptAssignmentId)) + addPeriods;
    if (total > maxPeriodsPerWeek) out.push(`${u.fullName} will have ${total} periods a week; the school's maximum is ${maxPeriodsPerWeek}`);
  }
  return out;
}

async function approvalNote(tx: Db, termId: string): Promise<string> {
  const set = await tx.assignmentSet.findUnique({ where: { termId } });
  return set?.status === 'APPROVED' ? ' (changed after the term\'s assignments were approved)' : '';
}

function termDate(term: { startDate: Date; endDate: Date; status: string }, wanted?: string): string {
  const today = todayInHarare();
  const start = isoOf(term.startDate), end = isoOf(term.endDate);
  const d = wanted ?? (term.status === 'OPEN' ? today : start);
  if (d < start || d > end) throw new ServiceError(`The date must fall inside the term (${start} to ${end})`, 422);
  return d;
}

// ─── Creating, changing, ending ──────────────────────────────────────────────

export async function createAssignment(user: Actor, raw: AssignmentInput) {
  const input = AssignmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const teacher = await requireTeacher(tx, user.schoolId, input.teacherId);
    const co = input.coTeacherId ? await requireTeacher(tx, user.schoolId, input.coTeacherId, 'The second teacher') : null;
    const ctx = await loadContext(tx, user.schoolId, input);
    const startDate = termDate(term, input.startDate);

    const live = await tx.teacherAssignment.findFirst({
      where: { termId: term.id, subjectId: input.subjectId, status: 'ACTIVE', ...(input.classId ? { classId: input.classId } : { groupId: input.groupId! }) },
      include: { teacher: { select: { fullName: true } } },
    });
    if (live) throw new ServiceError(`${ctx.target.name} already has ${live.teacher.fullName} teaching ${ctx.subject.name} in ${term.name}. Change the teacher on that assignment instead.`, 409);

    const warnings = await loadWarnings(tx, user.schoolId, term.id, [teacher, co], input.periodsPerWeek);
    const a = await tx.teacherAssignment.create({
      data: {
        schoolId: user.schoolId, termId: term.id, teacherId: teacher.id, coTeacherId: co?.id ?? null, subjectId: input.subjectId,
        classId: input.classId ?? null, groupId: input.groupId ?? null, periodsPerWeek: input.periodsPerWeek, doublesPerWeek: input.doublesPerWeek, startDate: toDay(startDate),
      },
    });
    await mirrorToMarks(tx, user.schoolId, a);
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'CREATE_TEACHER_ASSIGNMENT', entityType: 'TeacherAssignment', entityId: a.id,
        detail: `${teacher.fullName} teaches ${ctx.subject.name} to ${ctx.target.name}, ${a.periodsPerWeek} periods a week${await approvalNote(tx, term.id)}`,
        after: { term: term.name, teacher: teacher.fullName, coTeacher: co?.fullName ?? null, subject: ctx.subject.name, target: ctx.target.name, periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek },
      },
      tx,
    );
    await notifyUsers(tx, user.schoolId, dedupe([teacher.id, co?.id].filter((x): x is string => !!x)).filter((id) => id !== user.id), {
      type: 'ASSIGNMENT', title: `You teach ${ctx.subject.name} to ${ctx.target.name}`, body: `${a.periodsPerWeek} periods a week in ${term.name}`, link: '/academics/assignments',
    });
    return { id: a.id, warnings };
  });
}

export const UpdateAssignmentSchema = z
  .object({ periodsPerWeek: periods, doublesPerWeek: doubles, coTeacherId: idSchema.nullable() })
  .partial()
  .strict();

/** Changes the periods or the second teacher of a live assignment. (The main teacher changes through replaceTeacher.) */
export async function updateAssignment(user: Actor, id: string, raw: z.input<typeof UpdateAssignmentSchema>) {
  const input = UpdateAssignmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.teacherAssignment.findFirst({ where: { id }, include: { subject: { select: { name: true } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { id: true, fullName: true } } } });
    if (!a) throw new ServiceError('Assignment not found', 404);
    const term = await resolveTerm(tx, user.schoolId, a.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so it cannot be changed`, 409);
    if (a.status !== 'ACTIVE') throw new ServiceError('This assignment has ended. Start a new one instead.', 409);
    const next = { periodsPerWeek: input.periodsPerWeek ?? a.periodsPerWeek, doublesPerWeek: input.doublesPerWeek ?? a.doublesPerWeek };
    if (next.doublesPerWeek * 2 > next.periodsPerWeek) throw new ServiceError('Double periods use two periods each, so they cannot be more than half the periods', 422);
    const tt = await currentTimetableId(tx, a.termId);
    if (tt) {
      const placed = await tx.timetableSlot.findMany({ where: { timetableId: tt, assignmentId: a.id }, select: { isDouble: true } });
      if (placed.length > next.periodsPerWeek) throw new ServiceError(`${placed.length} periods are already on the timetable. Take some off before cutting this to ${next.periodsPerWeek}.`, 409);
      if (placed.filter((p) => p.isDouble).length / 2 > next.doublesPerWeek) throw new ServiceError('More double periods are on the timetable than this allows. Take some off first.', 409);
    }
    let coTeacherId = a.coTeacherId;
    let co: TeacherRef | null = null;
    if (input.coTeacherId !== undefined) {
      if (input.coTeacherId === a.teacherId) throw new ServiceError('The second teacher must be someone else', 422);
      co = input.coTeacherId ? await requireTeacher(tx, user.schoolId, input.coTeacherId, 'The second teacher') : null;
      coTeacherId = co?.id ?? null;
    }
    const warnings = await loadWarnings(tx, user.schoolId, a.termId, [a.teacher, co], next.periodsPerWeek, a.id);
    const after = await tx.teacherAssignment.update({ where: { id }, data: { ...next, coTeacherId } });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_TEACHER_ASSIGNMENT', entityType: 'TeacherAssignment', entityId: id,
        detail: `${a.subject.name} for ${a.class?.name ?? a.group?.name}: ${next.periodsPerWeek} periods, ${next.doublesPerWeek} doubles${await approvalNote(tx, a.termId)}`,
        before: { periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek, coTeacherId: a.coTeacherId },
        after: { periodsPerWeek: after.periodsPerWeek, doublesPerWeek: after.doublesPerWeek, coTeacherId: after.coTeacherId },
      },
      tx,
    );
    return { warnings };
  });
}

export const ReplaceTeacherSchema = z.object({
  teacherId: idSchema,
  effectiveDate: isoDateSchema,
  reason: noteSchema(300),
});

/**
 * Changes the teacher in the middle of a term: the old assignment ends the day before the effective date and a new one
 * starts on it. Marks, registers and schemes already recorded keep the original teacher.
 */
export async function replaceTeacher(user: Actor, id: string, raw: z.input<typeof ReplaceTeacherSchema>) {
  const input = ReplaceTeacherSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const old = await tx.teacherAssignment.findFirst({ where: { id }, include: { subject: { select: { name: true } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { id: true, fullName: true } } } });
    if (!old) throw new ServiceError('Assignment not found', 404);
    const term = await writableTerm(tx, user.schoolId, old.termId);
    if (old.status !== 'ACTIVE') throw new ServiceError('This assignment has already ended', 409);
    if (input.teacherId === old.teacherId) throw new ServiceError(`${old.teacher.fullName} already teaches this`, 409);
    const eff = termDate(term, input.effectiveDate);
    if (eff <= isoOf(old.startDate)) throw new ServiceError(`The new teacher must start after ${isoOf(old.startDate)}, when ${old.teacher.fullName} started`, 422);
    const teacher = await requireTeacher(tx, user.schoolId, input.teacherId);
    const target = old.class?.name ?? old.group?.name ?? '';

    // The timetable being written moves to the new teacher; it must not put them in two places at once.
    const working = await tx.timetable.findFirst({ where: { termId: old.termId, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } });
    const warnings = await loadWarnings(tx, user.schoolId, old.termId, [teacher], old.periodsPerWeek);

    await tx.teacherAssignment.update({ where: { id }, data: { status: 'ENDED', endDate: toDay(addDays(eff, -1)) } });
    const next = await tx.teacherAssignment.create({
      data: {
        schoolId: user.schoolId, termId: old.termId, teacherId: teacher.id, coTeacherId: old.coTeacherId === teacher.id ? null : old.coTeacherId, subjectId: old.subjectId,
        classId: old.classId, groupId: old.groupId, periodsPerWeek: old.periodsPerWeek, doublesPerWeek: old.doublesPerWeek, startDate: toDay(eff),
      },
    });
    if (working) {
      const slots = await tx.timetableSlot.findMany({ where: { timetableId: working.id, assignmentId: id }, select: { id: true, periodId: true } });
      if (slots.length) {
        const busy = await tx.timetableSlot.findMany({ where: { timetableId: working.id, teacherId: teacher.id, periodId: { in: slots.map((s) => s.periodId) } }, select: { id: true } });
        if (busy.length) throw new ServiceError(`${teacher.fullName} already teaches in ${busy.length} of the periods this lesson uses on the timetable. Choose someone who is free, or move those lessons first.`, 409);
        await tx.timetableSlot.updateMany({ where: { timetableId: working.id, assignmentId: id }, data: { assignmentId: next.id, teacherId: teacher.id } });
      }
    }
    await mirrorToMarks(tx, user.schoolId, next);
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'REPLACE_TEACHER', entityType: 'TeacherAssignment', entityId: next.id,
        detail: `${old.subject.name} for ${target}: ${old.teacher.fullName} → ${teacher.fullName} from ${eff}${input.reason ? `. ${input.reason}` : ''}${await approvalNote(tx, old.termId)}`,
        before: { assignmentId: id, teacher: old.teacher.fullName, endedOn: addDays(eff, -1) }, after: { assignmentId: next.id, teacher: teacher.fullName, startsOn: eff, reason: input.reason ?? null },
      },
      tx,
    );
    await notifyUsers(tx, user.schoolId, [teacher.id].filter((x) => x !== user.id), { type: 'ASSIGNMENT', title: `You now teach ${old.subject.name} to ${target}`, body: `From ${eff}`, link: '/academics/assignments' });
    await notifyUsers(tx, user.schoolId, [old.teacher.id].filter((x) => x !== user.id), { type: 'ASSIGNMENT', title: `You stop teaching ${old.subject.name} to ${target}`, body: `Last day ${addDays(eff, -1)}`, link: '/academics/assignments' });
    return { id: next.id, warnings };
  });
}

export const EndAssignmentSchema = z.object({ date: isoDateSchema.optional(), reason: noteSchema(300) });

/** Stops an assignment without a replacement (for example a teacher who has left). */
export async function endAssignment(user: Actor, id: string, raw: z.input<typeof EndAssignmentSchema> = {}) {
  const input = EndAssignmentSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.teacherAssignment.findFirst({ where: { id }, include: { subject: { select: { name: true } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { id: true, fullName: true } } } });
    if (!a) throw new ServiceError('Assignment not found', 404);
    const term = await writableTerm(tx, user.schoolId, a.termId);
    if (a.status !== 'ACTIVE') throw new ServiceError('This assignment has already ended', 409);
    const date = termDate(term, input.date ?? (term.status === 'OPEN' ? todayInHarare() : isoOf(a.startDate)));
    if (date < isoOf(a.startDate)) throw new ServiceError(`It cannot end before it started (${isoOf(a.startDate)})`, 422);
    await tx.teacherAssignment.update({ where: { id }, data: { status: 'ENDED', endDate: toDay(date) } });
    // Lessons nobody teaches any more come off the timetable being written (published versions keep their history).
    await tx.timetableSlot.deleteMany({ where: { assignmentId: id, timetable: { status: { in: ['DRAFT'] } } } });
    await unmirror(tx, a);
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'END_TEACHER_ASSIGNMENT', entityType: 'TeacherAssignment', entityId: id, detail: `${a.teacher.fullName} stops teaching ${a.subject.name} to ${a.class?.name ?? a.group?.name} on ${date}${input.reason ? `. ${input.reason}` : ''}${await approvalNote(tx, a.termId)}`, before: { status: 'ACTIVE' }, after: { status: 'ENDED', endDate: date } },
      tx,
    );
    await notifyUsers(tx, user.schoolId, [a.teacher.id].filter((x) => x !== user.id), { type: 'ASSIGNMENT', title: `You stop teaching ${a.subject.name} to ${a.class?.name ?? a.group?.name}`, body: `Last day ${date}`, link: '/academics/assignments' });
  });
}

/** Removes an assignment made by mistake. Once it has lessons, a scheme or marks, it can only be ended. */
export async function removeAssignment(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.teacherAssignment.findFirst({ where: { id }, include: { subject: { select: { name: true } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { fullName: true } }, _count: { select: { slots: true, schemes: true } } } });
    if (!a) throw new ServiceError('Assignment not found', 404);
    await writableTerm(tx, user.schoolId, a.termId);
    if (a._count.slots || a._count.schemes) throw new ServiceError('This assignment already has lessons on the timetable or a scheme of work, so it cannot be removed. End it instead.', 409);
    if (a.classId) {
      const sa = await tx.subjectAssignment.findUnique({ where: { subjectId_classId_termId: { subjectId: a.subjectId, classId: a.classId, termId: a.termId } } });
      if (sa && sa.marksStatus !== 'NOT_STARTED') throw new ServiceError('Marks have been entered for this subject, so the assignment cannot be removed. End it instead.', 409);
    }
    await tx.teacherAssignment.delete({ where: { id } });
    await unmirror(tx, a);
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'END_TEACHER_ASSIGNMENT', entityType: 'TeacherAssignment', entityId: id, detail: `Removed: ${a.teacher.fullName} teaching ${a.subject.name} to ${a.class?.name ?? a.group?.name}${await approvalNote(tx, a.termId)}`, before: { teacherId: a.teacherId, subjectId: a.subjectId } },
      tx,
    );
  });
}

// ─── Approval of the whole set ───────────────────────────────────────────────

export async function assignmentSet(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const set = await tx.assignmentSet.findUnique({ where: { termId: term.id } });
    const count = await tx.teacherAssignment.count({ where: { termId: term.id, status: 'ACTIVE' } });
    const names = await tx.user.findMany({ where: { id: { in: [set?.submittedById, set?.approvedById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const nm = new Map(names.map((n) => [n.id, n.fullName]));
    return {
      termId: term.id, status: set?.status ?? 'DRAFT', assignments: count, note: set?.note ?? null,
      submittedBy: set?.submittedById ? nm.get(set.submittedById) ?? null : null, submittedAt: set?.submittedAt?.toISOString() ?? null,
      approvedBy: set?.approvedById ? nm.get(set.approvedById) ?? null : null, approvedAt: set?.approvedAt?.toISOString() ?? null,
    };
  });
}

/** Sends the term's assignments to the Head. Gaps do not stop it, but the Head is told how many there are. */
export async function submitAssignments(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, termId);
    const count = await tx.teacherAssignment.count({ where: { termId: term.id, status: 'ACTIVE' } });
    if (count === 0) throw new ServiceError('There are no teacher assignments to send yet', 409);
    const set = await tx.assignmentSet.findUnique({ where: { termId: term.id } });
    if (set?.status === 'PENDING') throw new ServiceError('The assignments are already waiting for approval', 409);
    if (set?.status === 'APPROVED') throw new ServiceError('The assignments are already approved. Single changes can still be made and are logged.', 409);
    const gaps = (await findGaps(tx, term.id)).length;
    const data = { status: 'PENDING' as const, submittedById: user.id, submittedAt: new Date(), approvedById: null, approvedAt: null, note: null };
    await tx.assignmentSet.upsert({ where: { termId: term.id }, update: data, create: { schoolId: user.schoolId, termId: term.id, ...data } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SUBMIT_ASSIGNMENTS', entityType: 'AcademicTerm', entityId: term.id, detail: `${term.name}: ${count} teacher assignments sent for approval (${gaps} gap${gaps === 1 ? '' : 's'})`, after: { assignments: count, gaps } }, tx);
    await notifyUsers(tx, user.schoolId, await peopleWith(tx, user.schoolId, 'academics.assignments.approve', user.id), {
      type: 'ASSIGNMENTS', title: 'Teacher assignments need approval', body: `${term.name}: ${count} assignments${gaps ? `, ${gaps} subject gap${gaps === 1 ? '' : 's'}` : ''}`, link: '/academics/assignments',
    });
    return { assignments: count, gaps };
  });
}

export const DecideSetSchema = z.object({ decision: z.enum(['APPROVE', 'RETURN']), note: noteSchema(300), termId: idSchema.optional() });

/** The Head approves the set (the approver is recorded on every assignment) or returns it with a note. */
export async function decideAssignments(user: Actor, raw: z.input<typeof DecideSetSchema>) {
  const input = DecideSetSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const set = await tx.assignmentSet.findUnique({ where: { termId: term.id } });
    if (!set || set.status !== 'PENDING') throw new ServiceError('No assignments are waiting for approval', 409);
    if (input.decision === 'RETURN' && !input.note) throw new ServiceError('Say what must be fixed', 422);
    if (input.decision === 'APPROVE') {
      const now = new Date();
      await tx.teacherAssignment.updateMany({ where: { termId: term.id, status: 'ACTIVE', approvedById: null }, data: { approvedById: user.id, approvedAt: now } });
      await tx.assignmentSet.update({ where: { termId: term.id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: now, note: input.note ?? null } });
    } else {
      await tx.assignmentSet.update({ where: { termId: term.id }, data: { status: 'RETURNED', note: input.note ?? null } });
    }
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: input.decision === 'APPROVE' ? 'APPROVE_ASSIGNMENTS' : 'RETURN_ASSIGNMENTS', entityType: 'AcademicTerm', entityId: term.id, detail: `${term.name}: teacher assignments ${input.decision === 'APPROVE' ? 'approved' : 'returned'}${input.note ? `: ${input.note}` : ''}`, after: { decision: input.decision } },
      tx,
    );
    await notifyUsers(tx, user.schoolId, [set.submittedById].filter((x): x is string => !!x && x !== user.id), {
      type: 'ASSIGNMENTS', title: `Teacher assignments ${input.decision === 'APPROVE' ? 'approved' : 'returned'}`, body: input.note ?? undefined, link: '/academics/assignments',
    });
    return { status: input.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED' };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface AssignmentRow {
  id: string; termId: string; teacherId: string; teacherName: string; initials: string; coTeacherId: string | null; coTeacherName: string | null;
  subjectId: string; subjectName: string; shortName: string; colour: string; classId: string | null; groupId: string | null; target: string;
  periodsPerWeek: number; doublesPerWeek: number; startDate: string; endDate: string | null; status: 'ACTIVE' | 'ENDED'; approved: boolean; placed: number;
}

const ROW_INCLUDE = {
  teacher: { select: { id: true, fullName: true } }, coTeacher: { select: { id: true, fullName: true } },
  subject: { select: { id: true, name: true, shortName: true, colour: true } },
  class: { select: { id: true, name: true } }, group: { select: { id: true, name: true } },
} satisfies Prisma.TeacherAssignmentInclude;

async function rows(tx: Db, where: Prisma.TeacherAssignmentWhereInput, termId: string): Promise<AssignmentRow[]> {
  const list = await tx.teacherAssignment.findMany({ where, include: ROW_INCLUDE, orderBy: [{ subject: { name: 'asc' } }, { startDate: 'asc' }] });
  const tt = await currentTimetableId(tx, termId);
  const placed = new Map<string, number>();
  if (tt) for (const g of await tx.timetableSlot.groupBy({ by: ['assignmentId'], where: { timetableId: tt }, _count: { _all: true } })) placed.set(g.assignmentId, g._count._all);
  return list.map((a) => ({
    id: a.id, termId: a.termId, teacherId: a.teacherId, teacherName: a.teacher.fullName, initials: initialsOf(a.teacher.fullName), coTeacherId: a.coTeacherId, coTeacherName: a.coTeacher?.fullName ?? null,
    subjectId: a.subjectId, subjectName: a.subject.name, shortName: a.subject.shortName ?? a.subject.name, colour: a.subject.colour, classId: a.classId, groupId: a.groupId,
    target: a.class?.name ?? a.group?.name ?? '', periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek, startDate: isoOf(a.startDate), endDate: a.endDate ? isoOf(a.endDate) : null,
    status: a.status, approved: !!a.approvedById, placed: placed.get(a.id) ?? 0,
  }));
}

/** The assignments a person may see: all for the administrator, only their own for a teacher. */
export async function listAssignments(user: Actor, opts: { termId?: string; classId?: string; teacherId?: string; includeEnded?: boolean } = {}) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, opts.termId);
    const own = !holds(user, 'academics.assignments.manage') && !isFull(user);
    const where: Prisma.TeacherAssignmentWhereInput = {
      termId: term.id, ...(opts.includeEnded ? {} : { status: 'ACTIVE' }),
      ...(opts.classId ? { classId: opts.classId } : {}), ...(opts.teacherId ? { teacherId: opts.teacherId } : {}),
      ...(own ? { OR: [{ teacherId: user.id }, { coTeacherId: user.id }] } : {}),
    };
    return { term: { id: term.id, name: term.name, status: term.status }, assignments: await rows(tx, where, term.id) };
  });
}

export type GridCell =
  | { state: 'na' }
  | { state: 'empty' | 'gap' }
  | { state: 'assigned'; assignmentId: string; teacherName: string; initials: string; periodsPerWeek: number }
  | { state: 'group'; assignmentId: string; groupName: string; teacherName: string; initials: string };

/** Classes down the side, subjects across the top, the teacher's initials in each cell; unassigned cells are gaps to fill. */
export async function assignmentGrid(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const manage = holds(user, 'academics.assignments.manage');
    let classFilter: string[] | undefined;
    if (!manage && !isFull(user)) {
      const s = await ownScope(tx, user, term.id);
      classFilter = dedupe([...s.classTeacherOf, ...s.taughtClasses]);
    }
    const classes = await tx.schoolClass.findMany({
      where: { active: true, level: { active: true }, ...(classFilter ? { id: { in: classFilter } } : {}) },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, levelId: true },
    });
    const [offered, assignments, subjects] = await Promise.all([
      tx.subjectLevel.findMany({ where: { subject: { active: true } }, select: { subjectId: true, levelId: true } }),
      tx.teacherAssignment.findMany({ where: { termId: term.id, status: 'ACTIVE' }, include: { teacher: { select: { fullName: true } }, group: { select: { name: true } } } }),
      tx.subject.findMany({ where: { active: true }, orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }], select: { id: true, name: true, shortName: true, colour: true } }),
    ]);
    const taken = await classSubjects(tx, term.id, classes.map((c) => c.id));
    const levelsOf = new Map<string, Set<string>>();
    for (const o of offered) levelsOf.set(o.subjectId, (levelsOf.get(o.subjectId) ?? new Set()).add(o.levelId));
    const classLevels = new Set(classes.map((c) => c.levelId));
    const columns = subjects.filter((s) => Array.from(levelsOf.get(s.id) ?? []).some((l) => classLevels.has(l)));

    // A group lesson shows in the class cell of every class that has students in the group.
    const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
    const members = groupIds.length ? await tx.teachingGroupStudent.findMany({ where: { groupId: { in: groupIds } }, select: { groupId: true, studentId: true } }) : [];
    const enrol = await tx.enrollment.findMany({ where: { termId: term.id, status: 'ACTIVE', classId: { in: classes.map((c) => c.id) } }, select: { classId: true, studentId: true } });
    const classOfStudent = new Map(enrol.map((e) => [e.studentId, e.classId]));
    const groupClasses = new Map<string, Set<string>>();
    for (const m of members) { const c = classOfStudent.get(m.studentId); if (c) groupClasses.set(m.groupId, (groupClasses.get(m.groupId) ?? new Set()).add(c)); }

    const cells: Record<string, GridCell> = {};
    for (const c of classes) {
      for (const s of columns) {
        const key = `${c.id}:${s.id}`;
        if (!levelsOf.get(s.id)?.has(c.levelId)) { cells[key] = { state: 'na' }; continue; }
        const direct = assignments.find((a) => a.classId === c.id && a.subjectId === s.id);
        if (direct) { cells[key] = { state: 'assigned', assignmentId: direct.id, teacherName: direct.teacher.fullName, initials: initialsOf(direct.teacher.fullName), periodsPerWeek: direct.periodsPerWeek }; continue; }
        const viaGroup = assignments.find((a) => a.groupId && a.subjectId === s.id && groupClasses.get(a.groupId)?.has(c.id));
        if (viaGroup) { cells[key] = { state: 'group', assignmentId: viaGroup.id, groupName: viaGroup.group!.name, teacherName: viaGroup.teacher.fullName, initials: initialsOf(viaGroup.teacher.fullName) }; continue; }
        cells[key] = { state: taken.get(c.id)?.subjects.has(s.id) ? 'gap' : 'empty' };
      }
    }
    return {
      term: { id: term.id, name: term.name, status: term.status },
      classes: classes.map((c) => ({ id: c.id, name: c.name })), subjects: columns.map((s) => ({ id: s.id, name: s.name, shortName: s.shortName ?? s.name, colour: s.colour })), cells,
    };
  });
}

export type LoadStatus = 'over' | 'ok' | 'under' | 'none';
const UNDER_LOAD = 0.5;

export function loadStatus(periods: number, max: number): LoadStatus {
  if (periods === 0) return 'none';
  if (periods > max) return 'over';
  return periods < max * UNDER_LOAD ? 'under' : 'ok';
}

/** Each teacher with their subjects, classes, periods a week and the workload against the school's maximum. */
export async function teacherWorkload(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const settings = await loadSettings(tx, user.schoolId);
    const own = !holds(user, 'academics.assignments.manage') && !isFull(user);
    const assignments = await rows(tx, { termId: term.id, status: 'ACTIVE', ...(own ? { OR: [{ teacherId: user.id }, { coTeacherId: user.id }] } : {}) }, term.id);
    const teachers = await tx.user.findMany({
      where: { active: true, isSupport: false, ...(own ? { id: user.id } : {}), OR: [{ userRoles: { some: { role: { key: 'TEACHER' } } } }, { id: { in: dedupe(assignments.map((a) => a.teacherId)) } }] },
      select: { id: true, fullName: true }, orderBy: { fullName: 'asc' },
    });
    const covers = await tx.coverLesson.groupBy({ by: ['coverTeacherId'], where: { date: { gte: term.startDate, lte: term.endDate } }, _count: { _all: true } });
    const coverBy = new Map(covers.map((c) => [c.coverTeacherId, c._count._all]));
    return {
      term: { id: term.id, name: term.name, status: term.status }, maxPeriods: settings.maxPeriodsPerWeek,
      teachers: teachers.map((t) => {
        const mine = assignments.filter((a) => a.teacherId === t.id || a.coTeacherId === t.id);
        const periods = mine.reduce((s, a) => s + a.periodsPerWeek, 0);
        return {
          id: t.id, name: t.fullName, initials: initialsOf(t.fullName), periods, maxPeriods: settings.maxPeriodsPerWeek,
          pct: Math.round((periods / settings.maxPeriodsPerWeek) * 100), status: loadStatus(periods, settings.maxPeriodsPerWeek), covers: coverBy.get(t.id) ?? 0,
          assignments: mine.map((a) => ({ id: a.id, subject: a.shortName, target: a.target, periods: a.periodsPerWeek, second: a.coTeacherId === t.id })),
        };
      }),
    };
  });
}

/** Every subject a class takes that has no teacher, and every teacher over or under load. */
export async function gapsReport(user: Actor, termId?: string) {
  const load = await teacherWorkload(user, termId);
  const gaps = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, load.term.id);
    const own = !holds(user, 'academics.assignments.manage') && !isFull(user);
    let classIds: string[] | undefined;
    if (own) { const s = await ownScope(tx, user, term.id); classIds = dedupe([...s.classTeacherOf, ...s.taughtClasses]); if (classIds.length === 0) return []; }
    return findGaps(tx, term.id, classIds);
  });
  return {
    term: load.term, gaps,
    over: load.teachers.filter((t) => t.status === 'over'), under: load.teachers.filter((t) => t.status === 'under'), none: load.teachers.filter((t) => t.status === 'none'),
    maxPeriods: load.maxPeriods,
  };
}

/** For the teacher dashboard and class pages: may this person see this assignment? */
export async function assertAssignmentReachable(tx: Db, user: Actor, assignmentId: string) {
  const a = await tx.teacherAssignment.findFirst({ where: { id: assignmentId } });
  if (!a) throw new ServiceError('Assignment not found', 404);
  if (isFull(user) || holds(user, 'academics.assignments.manage')) return a;
  if (a.teacherId !== user.id && a.coTeacherId !== user.id) throw new ServiceError('Assignment not found', 404);
  return a;
}
