// The timetable. The Deputy builds it by placing lessons that already exist as teacher assignments; the rules in
// timetable-rules.ts refuse clashes (and the database refuses them again with unique indexes), so a published timetable
// is always possible to teach. A draft is checked (every assignment fully placed, no clashes), sent for Head approval and
// published with an effective date. Older versions are kept. Cover (relief) lessons and each teacher's "My day" live here too.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import {
  assertClassReachable, dedupe, holds, idSchema, initialsOf, isFull, isoDateSchema, isoOf, noteSchema, peopleWith, resolveTerm, todayInHarare, toDay,
  weekdayOf, writableTerm, type Actor,
} from '@/lib/academics/common';
import { applicableSchedule } from '@/lib/academics/bell';
import { schoolDayInfo, NO_SCHOOL_TEXT } from '@/lib/academics/school-days';
import {
  checkPlacement, dayPeriods, findClashes, periodName, placedReport, suggestSlots, type AssignInfo, type PlanData, type PlacementCheck, type SlotInfo,
} from '@/lib/academics/timetable-rules';

// ─── Loading the plan ────────────────────────────────────────────────────────

const SLOT_SELECT = {
  id: true, assignmentId: true, periodId: true, roomId: true, teacherId: true, classId: true, isDouble: true, pairId: true,
  assignment: { select: { coTeacherId: true, groupId: true, subjectId: true } },
} satisfies Prisma.TimetableSlotSelect;

const toSlotInfo = (s: Prisma.TimetableSlotGetPayload<{ select: typeof SLOT_SELECT }>): SlotInfo => ({
  id: s.id, assignmentId: s.assignmentId, periodId: s.periodId, roomId: s.roomId, teacherId: s.teacherId, coTeacherId: s.assignment.coTeacherId,
  classId: s.classId, groupId: s.assignment.groupId, subjectId: s.assignment.subjectId, isDouble: s.isDouble, pairId: s.pairId,
});

/** Everything the rules need for one timetable of a term. */
export async function loadPlan(tx: Db, termId: string, timetableId: string | null): Promise<PlanData & { scheduleId: string | null }> {
  const sched = await applicableSchedule(tx, termId);
  const [periods, slotRows, assignments, rooms, enrol] = await Promise.all([
    sched ? tx.period.findMany({ where: { scheduleId: sched.id } }) : Promise.resolve([]),
    timetableId ? tx.timetableSlot.findMany({ where: { timetableId }, select: SLOT_SELECT }) : Promise.resolve([]),
    tx.teacherAssignment.findMany({
      where: { termId },
      include: { subject: { select: { name: true, shortName: true, isPractical: true } }, class: { select: { name: true } }, group: { select: { name: true } }, teacher: { select: { fullName: true } } },
    }),
    tx.room.findMany(),
    tx.enrollment.findMany({ where: { termId, status: 'ACTIVE' }, select: { studentId: true, classId: true } }),
  ]);
  const groupIds = assignments.filter((a) => a.groupId).map((a) => a.groupId!);
  const members = groupIds.length ? await tx.teachingGroupStudent.findMany({ where: { groupId: { in: groupIds } }, select: { groupId: true, studentId: true } }) : [];
  const groupMembers = new Map<string, Set<string>>();
  for (const m of members) groupMembers.set(m.groupId, (groupMembers.get(m.groupId) ?? new Set()).add(m.studentId));
  const sizeOfClass = new Map<string, number>();
  for (const e of enrol) sizeOfClass.set(e.classId, (sizeOfClass.get(e.classId) ?? 0) + 1);
  const off = periods.length ? await tx.teacherAvailability.findMany({ where: { periodId: { in: periods.map((p) => p.id) } }, select: { userId: true, periodId: true } }) : [];
  const unavailable = new Map<string, Set<string>>();
  for (const o of off) unavailable.set(o.userId, (unavailable.get(o.userId) ?? new Set()).add(o.periodId));
  const names = new Map<string, string>();
  const infos = new Map<string, AssignInfo>();
  for (const a of assignments) {
    names.set(a.teacherId, a.teacher.fullName);
    infos.set(a.id, {
      id: a.id, teacherId: a.teacherId, coTeacherId: a.coTeacherId, subjectId: a.subjectId, classId: a.classId, groupId: a.groupId, periodsPerWeek: a.periodsPerWeek, doublesPerWeek: a.doublesPerWeek,
      isPractical: a.subject.isPractical, subjectName: a.subject.shortName ?? a.subject.name, targetName: a.class?.name ?? a.group?.name ?? '', teacherName: a.teacher.fullName,
      audienceSize: a.classId ? sizeOfClass.get(a.classId) ?? 0 : groupMembers.get(a.groupId!)?.size ?? 0, active: a.status === 'ACTIVE',
    });
  }
  const coIds = dedupe(assignments.map((a) => a.coTeacherId).filter((x): x is string => !!x));
  if (coIds.length) for (const u of await tx.user.findMany({ where: { id: { in: coIds } }, select: { id: true, fullName: true } })) names.set(u.id, u.fullName);
  return {
    scheduleId: sched?.id ?? null,
    periods: periods.map((p) => ({ id: p.id, dayOfWeek: p.dayOfWeek, periodNo: p.periodNo, start: p.start, end: p.end, type: p.type, label: p.label })),
    slots: slotRows.map(toSlotInfo), assignments: infos, groupMembers, studentClass: new Map(enrol.map((e) => [e.studentId, e.classId])), unavailable,
    rooms: new Map(rooms.map((r) => [r.id, { id: r.id, name: r.name, type: r.type, capacity: r.capacity, active: r.active }])), teacherNames: names,
  };
}

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * The timetable being written for a term. When there is none a new version is started: a copy of the published one (its
 * lessons follow the teacher now in charge of each assignment), or an empty one.
 */
async function ensureDraft(tx: Db, user: Actor, termId: string): Promise<{ id: string; version: number; status: string; created: boolean }> {
  const working = await tx.timetable.findFirst({ where: { termId, status: { in: ['DRAFT', 'PENDING'] } } });
  if (working) return { id: working.id, version: working.version, status: working.status, created: false };
  const last = await tx.timetable.findFirst({ where: { termId }, orderBy: { version: 'desc' }, select: { version: true } });
  const published = await tx.timetable.findFirst({ where: { termId, status: 'PUBLISHED' }, include: { slots: { include: { assignment: true } } } });
  const draft = await tx.timetable.create({ data: { schoolId: user.schoolId, termId, version: (last?.version ?? 0) + 1, status: 'DRAFT' } });
  if (published && published.slots.length) {
    const live = await tx.teacherAssignment.findMany({ where: { termId, status: 'ACTIVE' } });
    const key = (a: { subjectId: string; classId: string | null; groupId: string | null }) => `${a.subjectId}:${a.classId ?? ''}:${a.groupId ?? ''}`;
    const liveBy = new Map(live.map((a) => [key(a), a]));
    const idMap = new Map<string, string>(); // old pair id → new pair id
    let copied = 0;
    for (const s of published.slots) {
      const now = liveBy.get(key(s.assignment));
      if (!now) continue; // nobody teaches it any more
      const pairId = s.pairId ? idMap.get(s.pairId) ?? (idMap.set(s.pairId, `pair_${s.pairId}_${draft.version}`), idMap.get(s.pairId)!) : null;
      await tx.timetableSlot.create({
        data: { schoolId: user.schoolId, timetableId: draft.id, assignmentId: now.id, periodId: s.periodId, roomId: s.roomId, teacherId: now.teacherId, classId: s.classId, isDouble: s.isDouble, pairId },
      });
      copied++;
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'PLACE_LESSON', entityType: 'Timetable', entityId: draft.id, detail: `Timetable version ${draft.version} started as a copy of version ${published.version} (${copied} lessons)`, after: { copiedFrom: published.version, lessons: copied } }, tx);
  }
  return { id: draft.id, version: draft.version, status: 'DRAFT', created: true };
}

export async function timetableState(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const versions = await tx.timetable.findMany({ where: { termId: term.id }, orderBy: { version: 'desc' }, include: { _count: { select: { slots: true } } } });
    const working = versions.find((v) => v.status === 'DRAFT' || v.status === 'PENDING') ?? null;
    const published = versions.find((v) => v.status === 'PUBLISHED') ?? null;
    const plan = await loadPlan(tx, term.id, working?.id ?? published?.id ?? null);
    const report = placedReport(plan);
    const people = await tx.user.findMany({ where: { id: { in: dedupe(versions.flatMap((v) => [v.submittedById, v.approvedById]).filter((x): x is string => !!x)) } }, select: { id: true, fullName: true } });
    const nm = new Map(people.map((p) => [p.id, p.fullName]));
    return {
      term: { id: term.id, name: term.name, status: term.status },
      hasSchedule: !!plan.scheduleId,
      working: working ? { id: working.id, version: working.version, status: working.status, lessons: working._count.slots } : null,
      published: published ? { id: published.id, version: published.version, effectiveFrom: published.effectiveFrom ? isoOf(published.effectiveFrom) : null, publishedAt: published.publishedAt?.toISOString() ?? null, approvedBy: published.approvedById ? nm.get(published.approvedById) ?? null : null } : null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, effectiveFrom: v.effectiveFrom ? isoOf(v.effectiveFrom) : null, lessons: v._count.slots, submittedBy: v.submittedById ? nm.get(v.submittedById) ?? null : null, approvedBy: v.approvedById ? nm.get(v.approvedById) ?? null : null })),
      assignments: report.length, fullyPlaced: report.filter((r) => r.placed >= r.needed && r.doublesPlaced >= r.doublesNeeded).length,
      unplaced: report.filter((r) => r.placed < r.needed || r.doublesPlaced < r.doublesNeeded),
    };
  });
}

// ─── Views ───────────────────────────────────────────────────────────────────

export interface SlotView {
  slotId: string; assignmentId: string; periodId: string; subject: string; shortName: string; colour: string; teacher: string; initials: string; target: string;
  room: string | null; roomId: string | null; isDouble: boolean; pairId: string | null; isGroup: boolean;
}
export interface GridDay { dayOfWeek: number; name: string; periods: { id: string; periodNo: number; start: string; end: string; type: string; label: string | null }[] }
export interface ToPlace { assignmentId: string; subject: string; shortName: string; colour: string; teacher: string; target: string; placed: number; needed: number; doublesPlaced: number; doublesNeeded: number; isGroup: boolean }

/** The teacher in charge of an assignment's lessons on a date: the assignment in force that day for the same subject and class/group. */
function inForce(all: { id: string; termId: string; subjectId: string; classId: string | null; groupId: string | null; teacherId: string; coTeacherId: string | null; startDate: Date; endDate: Date | null }[], assignmentId: string, date: string) {
  const a = all.find((x) => x.id === assignmentId);
  if (!a) return null;
  const d = toDay(date).getTime();
  return all.find((x) => x.subjectId === a.subjectId && x.classId === a.classId && x.groupId === a.groupId && x.startDate.getTime() <= d && (!x.endDate || x.endDate.getTime() >= d)) ?? a;
}

/** The timetable version in force on a date: the newest published (or since superseded) version whose effective date has come. */
export async function timetableInForce(tx: Db, termId: string, date: string) {
  return tx.timetable.findFirst({ where: { termId, status: { in: ['PUBLISHED', 'SUPERSEDED'] }, effectiveFrom: { lte: toDay(date) } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
}

export const ViewSchema = z.object({
  termId: idSchema.optional(),
  view: z.enum(['class', 'teacher', 'room', 'master']),
  id: idSchema.optional(),
  /** Which version: the one being written ("working"), the published one (default for readers), or a version number. */
  version: z.string().optional(),
  date: isoDateSchema.optional(),
});

export async function timetableView(user: Actor, raw: z.input<typeof ViewSchema>) {
  const q = ViewSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, q.termId);
    const editor = isFull(user) || holds(user, 'academics.timetable.edit') || holds(user, 'academics.timetable.approve');
    const asOf = q.date ?? todayInHarare();

    // Who may look at which view: an editor anything; everyone else their own week and their own classes.
    if (!editor) {
      if (q.view === 'master' || q.view === 'room') throw new ServiceError('Timetable not found', 404);
      if (q.view === 'teacher' && q.id && q.id !== user.id) throw new ServiceError('Timetable not found', 404);
      if (q.view === 'class') { if (!q.id) throw new ServiceError('Choose a class', 422); await assertClassReachable(tx, user, q.id, term.id); }
    }
    const subject = q.view === 'teacher' ? q.id ?? user.id : q.id;
    if ((q.view === 'class' || q.view === 'room') && !subject) throw new ServiceError(`Choose a ${q.view}`, 422);

    let tt;
    if (q.version === 'working' && editor) tt = await tx.timetable.findFirst({ where: { termId: term.id, status: { in: ['DRAFT', 'PENDING'] } } });
    else if (q.version && /^\d+$/.test(q.version) && editor) tt = await tx.timetable.findFirst({ where: { termId: term.id, version: Number(q.version) } });
    else tt = (await tx.timetable.findFirst({ where: { termId: term.id, status: 'PUBLISHED' } })) ?? null;
    const draftExists = !!(await tx.timetable.findFirst({ where: { termId: term.id, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } }));

    const plan = await loadPlan(tx, term.id, tt?.id ?? null);
    const all = await tx.teacherAssignment.findMany({ where: { termId: term.id }, select: { id: true, termId: true, subjectId: true, classId: true, groupId: true, teacherId: true, coTeacherId: true, startDate: true, endDate: true } });
    const info = await tx.subject.findMany({ select: { id: true, name: true, shortName: true, colour: true } });
    const subj = new Map(info.map((s) => [s.id, s]));
    const slotRows = tt ? await tx.timetableSlot.findMany({ where: { timetableId: tt.id }, include: { room: { select: { name: true } }, assignment: { include: { class: { select: { name: true } }, group: { select: { name: true } } } } } }) : [];
    const published = tt?.status === 'PUBLISHED' || tt?.status === 'SUPERSEDED';
    const people = await tx.user.findMany({ where: { id: { in: dedupe(all.flatMap((a) => [a.teacherId, a.coTeacherId]).filter((x): x is string => !!x)) } }, select: { id: true, fullName: true } });
    const who = new Map(people.map((p) => [p.id, p.fullName]));

    interface Row { v: SlotView; teacherId: string; coTeacherId: string | null; classId: string | null; groupId: string | null }
    const rows: Row[] = slotRows.map((s) => {
      const eff = published ? inForce(all, s.assignmentId, asOf) : null;
      const teacherId = eff?.teacherId ?? s.teacherId;
      const sj = subj.get(s.assignment.subjectId)!;
      return {
        v: {
          slotId: s.id, assignmentId: s.assignmentId, periodId: s.periodId, subject: sj.name, shortName: sj.shortName ?? sj.name, colour: sj.colour, teacher: who.get(teacherId) ?? '', initials: initialsOf(who.get(teacherId) ?? '?'),
          target: s.assignment.class?.name ?? s.assignment.group?.name ?? '', room: s.room?.name ?? null, roomId: s.roomId, isDouble: s.isDouble, pairId: s.pairId, isGroup: !!s.assignment.groupId,
        },
        teacherId, coTeacherId: eff?.coTeacherId ?? s.assignment.coTeacherId, classId: s.classId, groupId: s.assignment.groupId,
      };
    });

    let shown: Row[];
    let title = 'Whole school';
    if (q.view === 'class') {
      const c = await tx.schoolClass.findFirst({ where: { id: subject! }, select: { name: true } });
      if (!c) throw new ServiceError('Class not found', 404);
      title = c.name;
      shown = rows.filter((s) => s.classId === subject || (s.groupId && Array.from(plan.groupMembers.get(s.groupId) ?? []).some((st) => plan.studentClass.get(st) === subject)));
    } else if (q.view === 'teacher') {
      title = who.get(subject!) ?? (await tx.user.findFirst({ where: { id: subject! }, select: { fullName: true } }))?.fullName ?? 'Teacher';
      shown = rows.filter((s) => s.teacherId === subject || s.coTeacherId === subject);
    } else if (q.view === 'room') {
      const r = plan.rooms.get(subject!);
      if (!r) throw new ServiceError('Room not found', 404);
      title = r.name;
      shown = rows.filter((s) => s.v.roomId === subject);
    } else shown = rows;

    const days: GridDay[] = Array.from(new Set(plan.periods.map((p) => p.dayOfWeek))).sort().map((d) => ({
      dayOfWeek: d, name: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]!,
      periods: dayPeriods(plan.periods, d).map((p) => ({ id: p.id, periodNo: p.periodNo, start: p.start, end: p.end, type: p.type, label: p.label ?? null })),
    }));
    const cells: Record<string, SlotView[]> = {};
    for (const s of shown) (cells[s.v.periodId] ??= []).push(s.v);

    // The "To place" list: the assignments of the class (or of the teacher), with how many periods are on the grid.
    let toPlace: ToPlace[] = [];
    if (tt && (q.view === 'class' || q.view === 'teacher')) {
      const rep = new Map(placedReport(plan).map((r) => [r.assignmentId, r]));
      const mineIds = Array.from(plan.assignments.values()).filter((a) => a.active !== false && (q.view === 'class'
        ? a.classId === subject || (a.groupId && Array.from(plan.groupMembers.get(a.groupId) ?? []).some((st) => plan.studentClass.get(st) === subject))
        : a.teacherId === subject || a.coTeacherId === subject)).map((a) => a.id);
      toPlace = mineIds.map((id) => {
        const a = plan.assignments.get(id)!, r = rep.get(id)!, sj = subj.get(a.subjectId)!;
        return { assignmentId: id, subject: sj.name, shortName: sj.shortName ?? sj.name, colour: sj.colour, teacher: a.teacherName, target: a.targetName, placed: r.placed, needed: r.needed, doublesPlaced: r.doublesPlaced, doublesNeeded: r.doublesNeeded, isGroup: !!a.groupId };
      }).sort((a, b) => a.shortName.localeCompare(b.shortName));
    }
    const rooms = Array.from(plan.rooms.values()).filter((r) => r.active).sort((a, b) => a.name.localeCompare(b.name));
    const canEdit = editor && holds(user, 'academics.timetable.edit') && term.status !== 'CLOSED';
    return {
      term: { id: term.id, name: term.name, status: term.status }, view: q.view, title, subjectId: subject ?? null,
      timetable: tt ? { id: tt.id, version: tt.version, status: tt.status, effectiveFrom: tt.effectiveFrom ? isoOf(tt.effectiveFrom) : null } : null, draftExists, days, cells, toPlace, rooms, canEdit,
      editable: canEdit && (tt ? tt.status === 'DRAFT' : true),
      unavailable: subject && q.view === 'teacher' ? Array.from(plan.unavailable.get(subject) ?? []) : [],
    };
  });
}

// ─── Placing lessons ─────────────────────────────────────────────────────────

export const PlaceSchema = z.object({
  termId: idSchema.optional(),
  assignmentId: idSchema,
  periodId: idSchema,
  roomId: idSchema.nullable().optional(),
  isDouble: z.boolean().default(false),
  /** Moving a lesson: this slot (and its pair) is taken out in the same step. */
  replaceSlotId: idSchema.optional(),
  /** The person has seen the amber warnings and wants to go ahead. */
});
export type PlaceInput = z.input<typeof PlaceSchema>;

async function workingTimetable(tx: Db, user: Actor, termId: string) {
  const term = await writableTerm(tx, user.schoolId, termId);
  const w = await ensureDraft(tx, user, term.id);
  if (w.status === 'PENDING') throw new ServiceError('The timetable is waiting for approval. It must be returned before it can be changed.', 409);
  return { term, timetableId: w.id, version: w.version };
}

function refuse(check: PlacementCheck): never {
  throw new ServiceError(check.errors[0]!, 409);
}

export async function placeLesson(user: Actor, raw: PlaceInput) {
  const input = PlaceSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.teacherAssignment.findFirst({ where: { id: input.assignmentId }, include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } });
    if (!a) throw new ServiceError('Assignment not found', 404);
    if (a.status !== 'ACTIVE') throw new ServiceError('This assignment has ended, so it cannot be placed', 409);
    const { term, timetableId, version } = await workingTimetable(tx, user, a.termId);
    const plan = await loadPlan(tx, term.id, timetableId);
    const ignore = new Set<string>();
    if (input.replaceSlotId) {
      const old = plan.slots.find((s) => s.id === input.replaceSlotId);
      if (!old || old.assignmentId !== a.id) throw new ServiceError('Lesson not found', 404);
      ignore.add(old.id);
      if (old.pairId) for (const s of plan.slots) if (s.pairId === old.pairId) ignore.add(s.id);
    }
    const check = checkPlacement(plan, { assignmentId: a.id, periodId: input.periodId, roomId: input.roomId ?? null, isDouble: input.isDouble, ignoreSlotIds: ignore });
    if (!check.ok) refuse(check);
    if (ignore.size) await tx.timetableSlot.deleteMany({ where: { id: { in: Array.from(ignore) } } });
    const pairId = input.isDouble ? `pair_${a.id}_${input.periodId}` : null;
    try {
      for (const periodId of check.periodIds) {
        await tx.timetableSlot.create({
          data: { schoolId: user.schoolId, timetableId, assignmentId: a.id, periodId, roomId: input.roomId ?? null, teacherId: a.teacherId, classId: a.classId, isDouble: input.isDouble, pairId },
        });
      }
    } catch (err) {
      if (typeof err === 'object' && err && 'code' in err && (err as { code: string }).code === 'P2002') throw new ServiceError('Someone else just put a lesson in that place. Reload the timetable.', 409);
      throw err;
    }
    const at = plan.periods.find((p) => p.id === input.periodId)!;
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'PLACE_LESSON', entityType: 'Timetable', entityId: timetableId,
        detail: `Version ${version}: ${a.subject.shortName ?? a.subject.name} for ${a.class?.name ?? a.group?.name} ${input.replaceSlotId ? 'moved to' : 'placed in'} ${periodName(at)}${input.isDouble ? ' (double)' : ''}`,
        after: { assignmentId: a.id, periodId: input.periodId, roomId: input.roomId ?? null, isDouble: input.isDouble, warnings: check.warnings },
      },
      tx,
    );
    return { warnings: check.warnings, timetableId };
  });
}

export async function removeLesson(user: Actor, slotId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.timetableSlot.findFirst({ where: { id: slotId }, include: { timetable: true, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } }, period: true } });
    if (!s) throw new ServiceError('Lesson not found', 404);
    await writableTerm(tx, user.schoolId, s.timetable.termId);
    if (s.timetable.status !== 'DRAFT') throw new ServiceError(s.timetable.status === 'PENDING' ? 'The timetable is waiting for approval. It must be returned before it can be changed.' : 'Published timetables cannot be edited. Start a new version.', 409);
    const ids = s.pairId ? (await tx.timetableSlot.findMany({ where: { timetableId: s.timetableId, pairId: s.pairId }, select: { id: true } })).map((x) => x.id) : [s.id];
    await tx.timetableSlot.deleteMany({ where: { id: { in: ids } } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'REMOVE_LESSON', entityType: 'Timetable', entityId: s.timetableId, detail: `Version ${s.timetable.version}: ${s.assignment.subject.shortName ?? s.assignment.subject.name} for ${s.assignment.class?.name ?? s.assignment.group?.name} taken off ${DAYS_OF[s.period.dayOfWeek]} period ${s.period.periodNo}`, before: { assignmentId: s.assignmentId, periodId: s.periodId } }, tx);
    return { removed: ids.length };
  });
}
const DAYS_OF = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Changes the room of a placed lesson. */
export async function setLessonRoom(user: Actor, slotId: string, roomId: string | null) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.timetableSlot.findFirst({ where: { id: slotId }, include: { timetable: true } });
    if (!s) throw new ServiceError('Lesson not found', 404);
    await writableTerm(tx, user.schoolId, s.timetable.termId);
    if (s.timetable.status !== 'DRAFT') throw new ServiceError('Only the version being written can be changed', 409);
    const plan = await loadPlan(tx, s.timetable.termId, s.timetableId);
    const pair = s.pairId ? plan.slots.filter((x) => x.pairId === s.pairId) : plan.slots.filter((x) => x.id === s.id);
    const ignore = new Set(pair.map((p) => p.id));
    let warnings: string[] = [];
    for (const p of pair) {
      const c = checkPlacement(plan, { assignmentId: p.assignmentId, periodId: p.periodId, roomId, isDouble: false, ignoreSlotIds: new Set(plan.slots.filter((x) => x.assignmentId === p.assignmentId).map((x) => x.id)) });
      const roomErrors = c.errors.filter((e) => /is already used|not in use|Room not found/.test(e));
      if (roomErrors.length) throw new ServiceError(roomErrors[0]!, 409);
      warnings = warnings.concat(c.warnings.filter((w) => /lab|holds/.test(w)));
    }
    await tx.timetableSlot.updateMany({ where: { id: { in: Array.from(ignore) } }, data: { roomId } });
    return { warnings: Array.from(new Set(warnings)) };
  });
}

export const SuggestSchema = z.object({ termId: idSchema.optional(), assignmentId: idSchema, isDouble: z.boolean().default(false), roomId: idSchema.nullable().optional() });

/** Every free slot where the lesson fits without a clash (and, for the others, why not). */
export async function suggestSlot(user: Actor, raw: z.input<typeof SuggestSchema>) {
  const q = SuggestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.teacherAssignment.findFirst({ where: { id: q.assignmentId }, select: { termId: true, status: true } });
    if (!a) throw new ServiceError('Assignment not found', 404);
    const working = await tx.timetable.findFirst({ where: { termId: a.termId, status: { in: ['DRAFT', 'PENDING'] } }, select: { id: true } })
      ?? (await tx.timetable.findFirst({ where: { termId: a.termId, status: 'PUBLISHED' }, select: { id: true } }));
    const plan = await loadPlan(tx, a.termId, working?.id ?? null);
    return { slots: suggestSlots(plan, q.assignmentId, { isDouble: q.isDouble, roomId: q.roomId ?? null }) };
  });
}

// ─── Check, approve, publish ─────────────────────────────────────────────────

/** What stops a timetable from being published: assignments not fully placed, and clashes. */
export async function checkTimetable(tx: Db, termId: string, timetableId: string) {
  const plan = await loadPlan(tx, termId, timetableId);
  const report = placedReport(plan);
  const problems: string[] = [];
  for (const r of report) {
    if (r.placed < r.needed) problems.push(`${r.subject} for ${r.target} (${r.teacher}): ${r.placed} of ${r.needed} periods placed`);
    else if (r.placed > r.needed) problems.push(`${r.subject} for ${r.target} has ${r.placed} periods placed but only ${r.needed} are assigned`);
    if (r.doublesPlaced < r.doublesNeeded) problems.push(`${r.subject} for ${r.target}: ${r.doublesPlaced} of ${r.doublesNeeded} double periods placed`);
  }
  // Lessons whose assignment ended and has not been replaced cannot be published.
  for (const s of plan.slots) if (plan.assignments.get(s.assignmentId)?.active === false) problems.push(`${plan.assignments.get(s.assignmentId)?.subjectName} for ${plan.assignments.get(s.assignmentId)?.targetName} is on the timetable but its assignment has ended`);
  problems.push(...findClashes(plan));
  return { problems: Array.from(new Set(problems)), lessons: plan.slots.length };
}

export async function submitTimetable(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, termId);
    const tt = await tx.timetable.findFirst({ where: { termId: term.id, status: { in: ['DRAFT', 'PENDING'] } } });
    if (!tt) throw new ServiceError('There is no timetable draft to send', 409);
    if (tt.status === 'PENDING') throw new ServiceError('The timetable is already waiting for approval', 409);
    const { problems, lessons } = await checkTimetable(tx, term.id, tt.id);
    if (problems.length) throw new ServiceError(`The timetable cannot be sent yet: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}`, 409);
    await tx.timetable.update({ where: { id: tt.id }, data: { status: 'PENDING', submittedById: user.id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SUBMIT_TIMETABLE', entityType: 'Timetable', entityId: tt.id, detail: `${term.name}: timetable version ${tt.version} (${lessons} lessons) sent for approval`, after: { version: tt.version, lessons } }, tx);
    await notifyUsers(tx, user.schoolId, await peopleWith(tx, user.schoolId, 'academics.timetable.approve', user.id), { type: 'TIMETABLE', title: 'The timetable needs approval', body: `${term.name}, version ${tt.version}`, link: '/academics/timetable' });
    return { version: tt.version, lessons };
  });
}

export const DecideTimetableSchema = z.object({
  termId: idSchema.optional(),
  decision: z.enum(['APPROVE', 'RETURN']),
  effectiveFrom: isoDateSchema.optional(),
  note: noteSchema(300),
});

/** Approves and publishes the timetable from an effective date, or returns it to the Deputy with a note. */
export async function decideTimetable(user: Actor, raw: z.input<typeof DecideTimetableSchema>) {
  const input = DecideTimetableSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const tt = await tx.timetable.findFirst({ where: { termId: term.id, status: 'PENDING' } });
    if (!tt) throw new ServiceError('No timetable is waiting for approval', 409);
    if (input.decision === 'RETURN') {
      if (!input.note) throw new ServiceError('Say what must be fixed', 422);
      await tx.timetable.update({ where: { id: tt.id }, data: { status: 'DRAFT' } });
      await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'RETURN_TIMETABLE', entityType: 'Timetable', entityId: tt.id, detail: `${term.name}: timetable version ${tt.version} returned: ${input.note}`, after: { note: input.note } }, tx);
      await notifyUsers(tx, user.schoolId, [tt.submittedById].filter((x): x is string => !!x && x !== user.id), { type: 'TIMETABLE', title: 'The timetable was returned', body: input.note, link: '/academics/timetable' });
      return { status: 'RETURNED' as const };
    }
    const today = todayInHarare();
    const effective = input.effectiveFrom ?? (today < isoOf(term.startDate) ? isoOf(term.startDate) : today);
    if (effective < isoOf(term.startDate) || effective > isoOf(term.endDate)) throw new ServiceError(`The effective date must fall inside ${term.name}`, 422);
    const prev = await tx.timetable.findFirst({ where: { termId: term.id, status: 'PUBLISHED' } });
    if (prev?.effectiveFrom && effective <= isoOf(prev.effectiveFrom)) throw new ServiceError(`The new timetable must start after the current one (${isoOf(prev.effectiveFrom)})`, 422);
    const { problems } = await checkTimetable(tx, term.id, tt.id);
    if (problems.length) throw new ServiceError(`The timetable cannot be published: ${problems.slice(0, 5).join('; ')}`, 409);
    if (prev) await tx.timetable.update({ where: { id: prev.id }, data: { status: 'SUPERSEDED' } });
    await tx.timetable.update({ where: { id: tt.id }, data: { status: 'PUBLISHED', approvedById: user.id, effectiveFrom: toDay(effective), publishedAt: new Date() } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'PUBLISH_TIMETABLE', entityType: 'Timetable', entityId: tt.id, detail: `${term.name}: timetable version ${tt.version} published from ${effective}${prev ? ` (replaces version ${prev.version})` : ''}`, after: { version: tt.version, effectiveFrom: effective, supersedes: prev?.version ?? null } }, tx);
    // Everyone who teaches, and every class teacher, is told.
    const slots = await tx.timetableSlot.findMany({ where: { timetableId: tt.id }, select: { teacherId: true, assignment: { select: { coTeacherId: true } } } });
    const cts = await tx.classTeacher.findMany({ where: { termId: term.id }, select: { userId: true } });
    const to = dedupe([...slots.flatMap((s) => [s.teacherId, s.assignment.coTeacherId]), ...cts.map((c) => c.userId)].filter((x): x is string => !!x));
    await notifyUsers(tx, user.schoolId, to.filter((x) => x !== user.id), { type: 'TIMETABLE', title: 'The timetable has been published', body: `Version ${tt.version}, from ${effective}`, link: '/academics/timetable/my-day' });
    return { status: 'PUBLISHED' as const, version: tt.version, effectiveFrom: effective };
  });
}

/** Starts a new version (a copy of the published one) to change a published timetable. */
export async function startNewVersion(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, termId);
    const d = await ensureDraft(tx, user, term.id);
    return { version: d.version, created: d.created };
  });
}

// ─── My day ──────────────────────────────────────────────────────────────────

export interface DayLesson {
  slotId: string; periodNo: number; start: string; end: string; subject: string; target: string; room: string | null; isDouble: boolean;
  isCover: boolean; coverFor: string | null; coveredBy: string | null; marked: boolean | null;
}

/** A teacher's lessons for a day from the published timetable (with cover lessons), and which one is next. */
export async function myDay(user: Actor, dateIn?: string, forUserId?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  const userId = forUserId && (isFull(user) || holds(user, 'academics.timetable.approve') || holds(user, 'academics.timetable.edit')) ? forUserId : user.id;
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, date);
  return db.$tx(async (tx) => {
    if (!day.isSchoolDay || !day.term) return { date, schoolDay: false, reason: day.reason ? NO_SCHOOL_TEXT[day.reason] : null, lessons: [] as DayLesson[], nextIndex: -1 };
    const tt = await timetableInForce(tx, day.term.id, date);
    if (!tt) return { date, schoolDay: true, reason: null, lessons: [] as DayLesson[], nextIndex: -1, noTimetable: true };
    const wd = weekdayOf(date);
    const slots = await tx.timetableSlot.findMany({
      where: { timetableId: tt.id, period: { dayOfWeek: wd } },
      include: { period: true, room: { select: { name: true } }, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } }, covers: { where: { date: toDay(date) } } },
      orderBy: { period: { start: 'asc' } },
    });
    const all = await tx.teacherAssignment.findMany({ where: { termId: day.term.id }, select: { id: true, termId: true, subjectId: true, classId: true, groupId: true, teacherId: true, coTeacherId: true, startDate: true, endDate: true } });
    const names = new Map((await tx.user.findMany({ where: { id: { in: dedupe(slots.flatMap((s) => s.covers.flatMap((c) => [c.coverTeacherId, c.absentTeacherId]))) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const marked = new Set((await tx.attendanceRegister.findMany({ where: { slotId: { in: slots.map((s) => s.id) }, date: toDay(date) }, select: { slotId: true } })).map((r) => r.slotId));
    const lessons: DayLesson[] = [];
    for (const s of slots) {
      const eff = inForce(all, s.assignmentId, date);
      const mine = eff?.teacherId === userId || eff?.coTeacherId === userId;
      const cover = s.covers[0];
      const covering = cover?.coverTeacherId === userId;
      if (!mine && !covering) continue;
      lessons.push({
        slotId: s.id, periodNo: s.period.periodNo, start: s.period.start, end: s.period.end, subject: s.assignment.subject.shortName ?? s.assignment.subject.name, target: s.assignment.class?.name ?? s.assignment.group?.name ?? '',
        room: s.room?.name ?? null, isDouble: s.isDouble, isCover: covering, coverFor: covering ? names.get(cover!.absentTeacherId) ?? null : null,
        coveredBy: mine && cover ? names.get(cover.coverTeacherId) ?? null : null, marked: marked.has(s.id) ? true : null,
      });
    }
    const nowHm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Harare' }).format(new Date());
    const nextIndex = date === todayInHarare() ? lessons.findIndex((l) => l.end > nowHm && !l.coveredBy) : -1;
    return { date, schoolDay: true, reason: null, lessons, nextIndex };
  });
}

// ─── Cover (relief) lessons ──────────────────────────────────────────────────

export const CoverQuerySchema = z.object({ date: isoDateSchema, absentTeacherId: idSchema });

/**
 * When a teacher is absent: their lessons that day from the published timetable, and for each the teachers who are free then,
 * ranked by fewest cover lessons this term.
 */
export async function coverCandidates(user: Actor, raw: z.input<typeof CoverQuerySchema>) {
  const q = CoverQuerySchema.parse(raw);
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, q.date);
  return db.$tx(async (tx) => {
    if (!day.isSchoolDay || !day.term) throw new ServiceError(day.reason ? NO_SCHOOL_TEXT[day.reason] : 'There is no school on this day', 409);
    const tt = await timetableInForce(tx, day.term.id, q.date);
    if (!tt) throw new ServiceError('There is no published timetable for this day', 409);
    const absent = await tx.user.findFirst({ where: { id: q.absentTeacherId, isSupport: false }, select: { id: true, fullName: true } });
    if (!absent) throw new ServiceError('Teacher not found', 404);
    const wd = weekdayOf(q.date);
    const all = await tx.teacherAssignment.findMany({ where: { termId: day.term.id }, select: { id: true, termId: true, subjectId: true, classId: true, groupId: true, teacherId: true, coTeacherId: true, startDate: true, endDate: true } });
    const slots = await tx.timetableSlot.findMany({
      where: { timetableId: tt.id, period: { dayOfWeek: wd } },
      include: { period: true, room: { select: { name: true } }, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } }, covers: { where: { date: toDay(q.date) } } },
      orderBy: { period: { start: 'asc' } },
    });
    const busyAt = new Map<string, Set<string>>(); // periodId → teachers teaching
    for (const s of slots) {
      const eff = inForce(all, s.assignmentId, q.date);
      for (const t of [eff?.teacherId, eff?.coTeacherId, s.covers[0]?.coverTeacherId]) if (t) busyAt.set(s.periodId, (busyAt.get(s.periodId) ?? new Set()).add(t));
    }
    const teachers = await tx.user.findMany({ where: { schoolId: user.schoolId, active: true, isSupport: false, id: { not: absent.id }, userRoles: { some: { role: { key: 'TEACHER' } } } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    const termRow = await tx.academicTerm.findFirstOrThrow({ where: { id: day.term.id }, select: { startDate: true } });
    const covers = await tx.coverLesson.groupBy({ by: ['coverTeacherId'], where: { date: { gte: termRow.startDate } }, _count: { _all: true } });
    const count = new Map(covers.map((c) => [c.coverTeacherId, c._count._all]));
    const periodIds = dedupe(slots.map((s) => s.periodId));
    const off = periodIds.length ? await tx.teacherAvailability.findMany({ where: { periodId: { in: periodIds } }, select: { userId: true, periodId: true } }) : [];
    const unavailable = new Set(off.map((o) => `${o.userId}:${o.periodId}`));
    const lessons = slots.filter((s) => { const eff = inForce(all, s.assignmentId, q.date); return eff?.teacherId === absent.id || eff?.coTeacherId === absent.id; });
    const people = new Map((await tx.user.findMany({ where: { id: { in: dedupe(slots.flatMap((s) => s.covers.map((c) => c.coverTeacherId))) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      date: q.date, absent,
      lessons: lessons.map((s) => ({
        slotId: s.id, periodNo: s.period.periodNo, start: s.period.start, end: s.period.end, subject: s.assignment.subject.shortName ?? s.assignment.subject.name,
        target: s.assignment.class?.name ?? s.assignment.group?.name ?? '', room: s.room?.name ?? null,
        covered: s.covers[0] ? { id: s.covers[0].id, teacherId: s.covers[0].coverTeacherId, teacher: people.get(s.covers[0].coverTeacherId) ?? '' } : null,
        free: teachers
          .filter((t) => !busyAt.get(s.periodId)?.has(t.id) && !unavailable.has(`${t.id}:${s.periodId}`))
          .map((t) => ({ id: t.id, name: t.fullName, covers: count.get(t.id) ?? 0 }))
          .sort((a, b) => a.covers - b.covers || a.name.localeCompare(b.name)),
      })),
    };
  });
}

export const AssignCoverSchema = z.object({ date: isoDateSchema, slotId: idSchema, coverTeacherId: idSchema });

export async function assignCover(user: Actor, raw: z.input<typeof AssignCoverSchema>) {
  const q = AssignCoverSchema.parse(raw);
  if (q.date < todayInHarare()) throw new ServiceError('Cover can only be arranged for today or a later day', 422);
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, q.date);
  return db.$tx(async (tx) => {
    if (!day.isSchoolDay || !day.term) throw new ServiceError(day.reason ? NO_SCHOOL_TEXT[day.reason] : 'There is no school on this day', 409);
    if (day.term.status === 'CLOSED') throw new ServiceError(`${day.term.name} is closed, so it cannot be changed`, 409);
    const tt = await timetableInForce(tx, day.term.id, q.date);
    const slot = await tx.timetableSlot.findFirst({ where: { id: q.slotId, ...(tt ? { timetableId: tt.id } : { id: 'none' }) }, include: { period: true, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } } } });
    if (!slot) throw new ServiceError('Lesson not found on the timetable in force that day', 404);
    if (slot.period.dayOfWeek !== weekdayOf(q.date)) throw new ServiceError('That lesson is not on that day of the week', 422);
    const all = await tx.teacherAssignment.findMany({ where: { termId: day.term.id }, select: { id: true, termId: true, subjectId: true, classId: true, groupId: true, teacherId: true, coTeacherId: true, startDate: true, endDate: true } });
    const eff = inForce(all, slot.assignmentId, q.date);
    const absentTeacherId = eff?.teacherId ?? slot.teacherId;
    if (q.coverTeacherId === absentTeacherId) throw new ServiceError('The cover teacher must be someone else', 422);
    const cover = await tx.user.findFirst({ where: { id: q.coverTeacherId, schoolId: user.schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: 'TEACHER' } } } }, select: { id: true, fullName: true } });
    if (!cover) throw new ServiceError('The cover teacher must be an active teacher', 409);
    // They must be free: not teaching, not already covering, not marked unavailable.
    const sameTime = await tx.timetableSlot.findMany({ where: { timetableId: tt!.id, periodId: slot.periodId }, include: { covers: { where: { date: toDay(q.date) } } } });
    for (const s of sameTime) {
      const e = inForce(all, s.assignmentId, q.date);
      if (e?.teacherId === cover.id || e?.coTeacherId === cover.id) throw new ServiceError(`${cover.fullName} is teaching in that period`, 409);
      if (s.covers.some((c) => c.coverTeacherId === cover.id && s.id !== slot.id)) throw new ServiceError(`${cover.fullName} is already covering another lesson in that period`, 409);
    }
    if (await tx.teacherAvailability.findFirst({ where: { userId: cover.id, periodId: slot.periodId } })) throw new ServiceError(`${cover.fullName} is not available in that period`, 409);
    const existing = await tx.coverLesson.findFirst({ where: { slotId: slot.id, date: toDay(q.date) } });
    const row = existing
      ? await tx.coverLesson.update({ where: { id: existing.id }, data: { coverTeacherId: cover.id, assignedById: user.id, absentTeacherId } })
      : await tx.coverLesson.create({ data: { schoolId: user.schoolId, date: toDay(q.date), slotId: slot.id, absentTeacherId, coverTeacherId: cover.id, assignedById: user.id } });
    const what = `${slot.assignment.subject.shortName ?? slot.assignment.subject.name} for ${slot.assignment.class?.name ?? slot.assignment.group?.name}, period ${slot.period.periodNo}`;
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ASSIGN_COVER', entityType: 'CoverLesson', entityId: row.id, detail: `${q.date}: ${cover.fullName} covers ${what}`, after: { date: q.date, slotId: slot.id, absentTeacherId, coverTeacherId: cover.id } }, tx);
    await notifyUsers(tx, user.schoolId, [cover.id].filter((x) => x !== user.id), { type: 'COVER', title: `You cover ${what}`, body: q.date, link: '/academics/timetable/my-day', dedupeKey: `cover:${row.id}:${cover.id}` });
    return { id: row.id };
  });
}

export async function removeCover(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const c = await tx.coverLesson.findFirst({ where: { id }, include: { coverTeacher: { select: { fullName: true } } } });
    if (!c) throw new ServiceError('Cover lesson not found', 404);
    if (isoOf(c.date) < todayInHarare()) throw new ServiceError('A cover lesson from an earlier day cannot be removed', 409);
    await tx.coverLesson.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'ASSIGN_COVER', entityType: 'CoverLesson', entityId: id, detail: `${isoOf(c.date)}: cover by ${c.coverTeacher.fullName} cancelled`, before: { coverTeacherId: c.coverTeacherId } }, tx);
    await notifyUsers(tx, user.schoolId, [c.coverTeacherId].filter((x) => x !== user.id), { type: 'COVER', title: 'A cover lesson was cancelled', body: isoOf(c.date), link: '/academics/timetable/my-day' });
  });
}

/** The daily cover list for the staff room. */
export async function coverList(user: Actor, dateIn?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.coverLesson.findMany({
      where: { date: toDay(date) }, orderBy: { slot: { period: { start: 'asc' } } },
      include: {
        slot: { include: { period: true, room: { select: { name: true } }, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } } } },
        absentTeacher: { select: { fullName: true } }, coverTeacher: { select: { fullName: true } },
      },
    });
    const school = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } });
    return {
      date, school: school.name,
      rows: rows.map((r) => ({
        id: r.id, periodNo: r.slot.period.periodNo, start: r.slot.period.start, end: r.slot.period.end, subject: r.slot.assignment.subject.shortName ?? r.slot.assignment.subject.name,
        target: r.slot.assignment.class?.name ?? r.slot.assignment.group?.name ?? '', room: r.slot.room?.name ?? null, absent: r.absentTeacher.fullName, cover: r.coverTeacher.fullName,
      })),
    };
  });
}

/** Whether a teacher is on the list a class page shows ("Timetable" tab): the class's published week. */
export async function classWeek(user: Actor, classId: string, termId?: string) {
  return timetableView(user, { termId, view: 'class', id: classId });
}

