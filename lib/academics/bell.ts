// The bell schedule (periods of each school day, breaks, assembly and sports as non-teaching slots), rooms, and the
// periods a teacher cannot teach. One schedule applies to every term (termId empty); a term may have its own.
import { z } from 'zod';
import type { PeriodType, RoomType } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { DAY_NAMES, idSchema, requireTeacher, resolveTerm, timeSchema, writableTerm, type Actor } from '@/lib/academics/common';

export const PERIOD_TYPES = ['LESSON', 'BREAK', 'ASSEMBLY', 'SPORTS'] as const satisfies readonly PeriodType[];
export const PERIOD_TYPE_LABEL: Record<PeriodType, string> = { LESSON: 'Lesson', BREAK: 'Break', ASSEMBLY: 'Assembly', SPORTS: 'Sports' };
export const ROOM_TYPES = ['CLASSROOM', 'LABORATORY', 'COMPUTER_LAB', 'WORKSHOP', 'HALL', 'FIELD'] as const satisfies readonly RoomType[];
export const ROOM_TYPE_LABEL: Record<RoomType, string> = { CLASSROOM: 'Classroom', LABORATORY: 'Laboratory', COMPUTER_LAB: 'Computer lab', WORKSHOP: 'Workshop', HALL: 'Hall', FIELD: 'Field' };

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface PeriodRow { id: string; periodNo: number; dayOfWeek: number; label: string | null; start: string; end: string; type: PeriodType }
export interface BellDay { dayOfWeek: number; name: string; periods: PeriodRow[] }
export interface BellView { id: string | null; name: string; scope: 'SCHOOL' | 'TERM' | 'NONE'; termId: string | null; days: BellDay[]; saturday: boolean }

/** The schedule that applies to a term: its own if it has one, else the school's. */
export async function applicableSchedule(tx: Db, termId: string | null) {
  const own = termId ? await tx.bellSchedule.findFirst({ where: { termId } }) : null;
  return own ?? (await tx.bellSchedule.findFirst({ where: { termId: null } }));
}

export async function loadBell(tx: Db, termId: string | null): Promise<BellView> {
  const sched = await applicableSchedule(tx, termId);
  if (!sched) return { id: null, name: 'Bell schedule', scope: 'NONE', termId, days: [], saturday: false };
  const periods = await tx.period.findMany({ where: { scheduleId: sched.id }, orderBy: [{ dayOfWeek: 'asc' }, { start: 'asc' }] });
  const days = Array.from(new Set(periods.map((p) => p.dayOfWeek))).sort().map((d) => ({
    dayOfWeek: d, name: DAY_NAMES[d]!,
    periods: periods.filter((p) => p.dayOfWeek === d).map((p) => ({ id: p.id, periodNo: p.periodNo, dayOfWeek: p.dayOfWeek, label: p.label, start: p.start, end: p.end, type: p.type })),
  }));
  return { id: sched.id, name: sched.name, scope: sched.termId ? 'TERM' : 'SCHOOL', termId: sched.termId, days, saturday: days.some((d) => d.dayOfWeek === 6) };
}

export async function getBell(user: Actor, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const [bell, def, own] = await Promise.all([loadBell(tx, term.id), loadBell(tx, null), tx.bellSchedule.findFirst({ where: { termId: term.id } })]);
    const used = await tx.timetableSlot.count({ where: { timetable: { termId: term.id } } });
    return { term: { id: term.id, name: term.name, status: term.status }, bell, schoolDefault: def, hasTermSchedule: !!own, inUse: used > 0 };
  });
}

// ─── Saving ──────────────────────────────────────────────────────────────────

const PeriodSchema = z.object({
  periodNo: z.number().int().min(1).max(20),
  label: z.string().trim().max(30).nullish(),
  start: timeSchema,
  end: timeSchema,
  type: z.enum(PERIOD_TYPES),
});
const DaySchema = z.object({ dayOfWeek: z.number().int().min(1).max(6), periods: z.array(PeriodSchema).min(1).max(20) });

export const BellSchema = z.object({
  /** Empty = the school's schedule for every term; a term id = a schedule for that term only. */
  termId: idSchema.nullable().default(null),
  name: z.string().trim().min(2).max(60).default('Bell schedule'),
  days: z.array(DaySchema).min(1, 'Add at least one school day').max(6),
});
export type BellInput = z.input<typeof BellSchema>;

/** Checks the periods of a day: numbered once, in time order, not overlapping. */
export function validateDay(day: z.output<typeof DaySchema>): string | null {
  const name = DAY_NAMES[day.dayOfWeek]!;
  const byNo = [...day.periods].sort((a, b) => a.periodNo - b.periodNo);
  for (let i = 1; i < byNo.length; i++) if (byNo[i]!.periodNo === byNo[i - 1]!.periodNo) return `${name}: period ${byNo[i]!.periodNo} is listed twice`;
  const byTime = [...day.periods].sort((a, b) => a.start.localeCompare(b.start));
  for (const p of byTime) if (p.end <= p.start) return `${name}: ${p.label ?? `period ${p.periodNo}`} must end after it starts`;
  for (let i = 1; i < byTime.length; i++) if (byTime[i]!.start < byTime[i - 1]!.end) return `${name}: ${byTime[i - 1]!.label ?? `period ${byTime[i - 1]!.periodNo}`} and ${byTime[i]!.label ?? `period ${byTime[i]!.periodNo}`} overlap`;
  // Numbers follow the clock, so "period 2" is always after "period 1".
  for (let i = 0; i < byTime.length; i++) if (byTime[i]!.periodNo !== byNo[i]!.periodNo) return `${name}: the period numbers must follow the times (period 1 first)`;
  return null;
}

export async function saveBell(user: Actor, raw: BellInput) {
  const input = BellSchema.parse(raw);
  const dayNos = input.days.map((d) => d.dayOfWeek);
  if (new Set(dayNos).size !== dayNos.length) throw new ServiceError('A day is listed twice', 422);
  for (const d of input.days) {
    const problem = validateDay(d);
    if (problem) throw new ServiceError(problem, 422);
  }
  if (!input.days.some((d) => d.periods.some((p) => p.type === 'LESSON'))) throw new ServiceError('The schedule needs at least one lesson period', 422);

  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = input.termId ? await writableTerm(tx, user.schoolId, input.termId) : null;
    let sched = await tx.bellSchedule.findFirst({ where: { termId: term?.id ?? null } });
    if (!sched) {
      sched = await tx.bellSchedule.create({ data: { schoolId: user.schoolId, termId: term?.id ?? null, name: input.name } });
    } else if (sched.name !== input.name) {
      await tx.bellSchedule.update({ where: { id: sched.id }, data: { name: input.name } });
    }
    const existing = await tx.period.findMany({ where: { scheduleId: sched.id } });
    const key = (d: number, n: number) => `${d}:${n}`;
    const wanted = new Map(input.days.flatMap((d) => d.periods.map((p) => [key(d.dayOfWeek, p.periodNo), { ...p, dayOfWeek: d.dayOfWeek }] as const)));
    let added = 0, changed = 0, removed = 0;

    for (const e of existing) {
      const w = wanted.get(key(e.dayOfWeek, e.periodNo));
      const where = `${DAY_NAMES[e.dayOfWeek]} ${e.label ?? `period ${e.periodNo}`}`;
      if (!w) {
        const slots = await tx.timetableSlot.count({ where: { periodId: e.id } });
        if (slots) throw new ServiceError(`${where} has lessons on a timetable, so it cannot be removed. Move those lessons first.`, 409);
        await tx.period.delete({ where: { id: e.id } });
        removed++;
      } else if (w.start !== e.start || w.end !== e.end || w.type !== e.type || (w.label ?? null) !== e.label) {
        if (w.type !== 'LESSON' && e.type === 'LESSON') {
          const slots = await tx.timetableSlot.count({ where: { periodId: e.id } });
          if (slots) throw new ServiceError(`${where} has lessons on a timetable, so it cannot become a ${PERIOD_TYPE_LABEL[w.type].toLowerCase()}. Move those lessons first.`, 409);
        }
        await tx.period.update({ where: { id: e.id }, data: { start: w.start, end: w.end, type: w.type, label: w.label ?? null } });
        changed++;
      }
    }
    const have = new Set(existing.map((e) => key(e.dayOfWeek, e.periodNo)));
    const fresh = Array.from(wanted).filter(([k]) => !have.has(k)).map(([, w]) => ({ schoolId: user.schoolId, scheduleId: sched!.id, periodNo: w.periodNo, dayOfWeek: w.dayOfWeek, label: w.label ?? null, start: w.start, end: w.end, type: w.type }));
    if (fresh.length) await tx.period.createMany({ data: fresh });
    added = fresh.length;
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'SAVE_BELL_SCHEDULE', entityType: 'BellSchedule', entityId: sched.id,
        detail: `${term ? term.name : 'School'} bell schedule saved: ${added} periods added, ${changed} changed, ${removed} removed`, after: { added, changed, removed, days: dayNos },
      },
      tx,
    );
    return { id: sched.id, added, changed, removed };
  });
}

/** Removes a term's own schedule so the term uses the school's again (only while it has no lessons). */
export async function removeTermBell(user: Actor, termId: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, termId);
    const s = await tx.bellSchedule.findFirst({ where: { termId: term.id } });
    if (!s) throw new ServiceError('This term uses the school bell schedule already', 409);
    if (await tx.timetableSlot.count({ where: { period: { scheduleId: s.id } } })) throw new ServiceError('Lessons are on the timetable for this schedule, so it cannot be removed', 409);
    await tx.bellSchedule.delete({ where: { id: s.id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_BELL_SCHEDULE', entityType: 'BellSchedule', entityId: s.id, detail: `${term.name}: back to the school bell schedule` }, tx);
  });
}

// ─── Rooms ───────────────────────────────────────────────────────────────────

export const RoomSchema = z.object({
  name: z.string().trim().min(1, 'Give the room a name').max(40),
  type: z.enum(ROOM_TYPES),
  capacity: z.number().int().min(1).max(2000),
  active: z.boolean().default(true),
});
export type RoomInput = z.input<typeof RoomSchema>;

export async function listRooms(user: Actor) {
  const rooms = await getScopedDb(user.schoolId, user.id).room.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { slots: true } } } });
  return rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity, active: r.active, lessons: r._count.slots }));
}

export async function saveRoom(user: Actor, id: string | null, raw: RoomInput) {
  const input = RoomSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const clash = await tx.room.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw new ServiceError(`There is already a room called ${clash.name}`, 409);
    let room;
    if (id) {
      if (!(await tx.room.findFirst({ where: { id } }))) throw new ServiceError('Room not found', 404);
      room = await tx.room.update({ where: { id }, data: input });
    } else room = await tx.room.create({ data: { schoolId: user.schoolId, ...input } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_ROOM', entityType: 'Room', entityId: room.id, detail: `Room ${room.name} (${ROOM_TYPE_LABEL[room.type]}, ${room.capacity}) ${id ? 'changed' : 'added'}`, after: { name: room.name, type: room.type, capacity: room.capacity, active: room.active } }, tx);
    return room;
  });
}

export async function deleteRoom(user: Actor, id: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const room = await tx.room.findFirst({ where: { id }, include: { _count: { select: { slots: true } } } });
    if (!room) throw new ServiceError('Room not found', 404);
    if (room._count.slots) throw new ServiceError(`${room.name} is used on a timetable. Make it inactive instead.`, 409);
    await tx.room.delete({ where: { id } });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SAVE_ROOM', entityType: 'Room', entityId: id, detail: `Room ${room.name} deleted`, before: { name: room.name } }, tx);
  });
}

// ─── Teacher availability ────────────────────────────────────────────────────

export async function getAvailability(user: Actor, userId: string, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const t = await tx.user.findFirst({ where: { id: userId, isSupport: false }, select: { id: true, fullName: true } });
    if (!t) throw new ServiceError('Teacher not found', 404);
    const sched = await applicableSchedule(tx, term.id);
    const rows = sched ? await tx.teacherAvailability.findMany({ where: { userId, period: { scheduleId: sched.id } }, select: { periodId: true } }) : [];
    return { teacher: t, unavailable: rows.map((r) => r.periodId) };
  });
}

export const AvailabilitySchema = z.object({ termId: idSchema.optional(), unavailable: z.array(idSchema).max(200) });

/** Sets the periods a teacher cannot teach (replacing what was set for the term's schedule). */
export async function setAvailability(user: Actor, userId: string, raw: z.input<typeof AvailabilitySchema>) {
  const input = AvailabilitySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await writableTerm(tx, user.schoolId, input.termId);
    const teacher = await requireTeacher(tx, user.schoolId, userId);
    const sched = await applicableSchedule(tx, term.id);
    if (!sched) throw new ServiceError('Set up the bell schedule first', 409);
    const periods = await tx.period.findMany({ where: { scheduleId: sched.id, type: 'LESSON' }, select: { id: true } });
    const valid = new Set(periods.map((p) => p.id));
    const wanted = Array.from(new Set(input.unavailable));
    if (wanted.some((id) => !valid.has(id))) throw new ServiceError('One of the periods is not a lesson period of this schedule', 422);
    await tx.teacherAvailability.deleteMany({ where: { userId, period: { scheduleId: sched.id } } });
    if (wanted.length) await tx.teacherAvailability.createMany({ data: wanted.map((periodId) => ({ schoolId: user.schoolId, userId, periodId })) });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'SET_AVAILABILITY', entityType: 'User', entityId: userId, detail: `${teacher.fullName}: ${wanted.length} period${wanted.length === 1 ? '' : 's'} marked unavailable`, after: { count: wanted.length } }, tx);
    return { unavailable: wanted.length };
  });
}
