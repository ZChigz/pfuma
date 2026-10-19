// The timetable rules, with no database: given the periods, the lessons already placed and the assignments, can this
// lesson go in this period? The service loads the data and calls these; tests call them directly.
//
// Hard rules (the placement is refused and the message says why):
//  • a teacher can't be in two lessons at once (the second teacher too);
//  • a class can't have two lessons at once, and a teaching group's students can't clash with their own class's lessons
//    or with another group that shares students;
//  • a room can't hold two lessons at once;
//  • a double period can't run across a break (the next period must be a lesson period right after the first);
//  • a class can't get more periods of a subject than its assignment says (nor more doubles than it allows).
// Warnings (allowed, shown in amber): the same subject twice in a day, a teacher with more than 4 periods in a row, a
// practical subject outside a lab, a teacher's free day or unavailable time.

export interface PeriodInfo { id: string; dayOfWeek: number; periodNo: number; start: string; end: string; type: 'LESSON' | 'BREAK' | 'ASSEMBLY' | 'SPORTS'; label?: string | null }
export interface SlotInfo {
  id: string; assignmentId: string; periodId: string; roomId: string | null; teacherId: string; coTeacherId: string | null;
  classId: string | null; groupId: string | null; subjectId: string; isDouble: boolean; pairId: string | null;
}
export interface AssignInfo {
  id: string; teacherId: string; coTeacherId: string | null; subjectId: string; classId: string | null; groupId: string | null;
  periodsPerWeek: number; doublesPerWeek: number; isPractical: boolean; subjectName: string; targetName: string; teacherName: string; audienceSize: number;
  /** False for an assignment that ended: its lessons may still be on a timetable but it is no longer planned. */
  active?: boolean;
}
export interface RoomInfo { id: string; name: string; type: 'CLASSROOM' | 'LABORATORY' | 'COMPUTER_LAB' | 'WORKSHOP' | 'HALL' | 'FIELD'; capacity: number; active: boolean }

export interface PlanData {
  periods: PeriodInfo[];
  slots: SlotInfo[];
  assignments: Map<string, AssignInfo>;
  /** Students of each teaching group, and the class each student is in this term. */
  groupMembers: Map<string, Set<string>>;
  studentClass: Map<string, string>;
  /** Periods a teacher cannot teach. */
  unavailable: Map<string, Set<string>>;
  rooms: Map<string, RoomInfo>;
  /** Names for messages. */
  teacherNames: Map<string, string>;
}

export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const LAB_TYPES = ['LABORATORY', 'COMPUTER_LAB', 'WORKSHOP'] as const;
export const MAX_IN_A_ROW = 4;

export interface PlacementRequest {
  assignmentId: string;
  periodId: string;
  roomId?: string | null;
  isDouble?: boolean;
  /** Slots that are being moved: they do not count against the new place. */
  ignoreSlotIds?: ReadonlySet<string>;
}
export interface PlacementCheck { ok: boolean; errors: string[]; warnings: string[]; periodIds: string[] }

const byId = (periods: PeriodInfo[]) => new Map(periods.map((p) => [p.id, p]));
export const periodName = (p: PeriodInfo) => `${DAYS[p.dayOfWeek]} ${p.label ?? `period ${p.periodNo}`}`;

/** The periods of the day in clock order. */
export function dayPeriods(periods: PeriodInfo[], dayOfWeek: number): PeriodInfo[] {
  return periods.filter((p) => p.dayOfWeek === dayOfWeek).sort((a, b) => a.start.localeCompare(b.start));
}

/** The period that follows `first` for a double: the very next one in the day, which must be a lesson (no break between). */
export function secondOfDouble(periods: PeriodInfo[], first: PeriodInfo): { second: PeriodInfo | null; problem: string | null } {
  const day = dayPeriods(periods, first.dayOfWeek);
  const next = day[day.findIndex((p) => p.id === first.id) + 1];
  if (!next) return { second: null, problem: `${periodName(first)} is the last period of the day, so a double period cannot start there` };
  if (next.type !== 'LESSON') return { second: null, problem: `A double period can't run across a break: ${next.label ?? PERIOD_WORD[next.type]} follows ${periodName(first)}` };
  return { second: next, problem: null };
}
const PERIOD_WORD = { LESSON: 'a lesson', BREAK: 'a break', ASSEMBLY: 'assembly', SPORTS: 'sports' } as const;

/** Who is in the room at a period: a class, or the students of a teaching group. */
type Audience = { classId: string | null; groupId: string | null };

function audiencesOverlap(data: PlanData, a: Audience, b: Audience): boolean {
  if (a.classId && b.classId) return a.classId === b.classId;
  if (a.groupId && b.groupId) {
    if (a.groupId === b.groupId) return true;
    const ma = data.groupMembers.get(a.groupId) ?? new Set<string>();
    const mb = data.groupMembers.get(b.groupId) ?? new Set<string>();
    for (const s of Array.from(ma)) if (mb.has(s)) return true;
    return false;
  }
  const [cls, grp] = a.classId ? [a.classId, b.groupId!] : [b.classId!, a.groupId!];
  for (const s of Array.from(data.groupMembers.get(grp) ?? [])) if (data.studentClass.get(s) === cls) return true;
  return false;
}

const teachesIn = (s: SlotInfo, userId: string) => s.teacherId === userId || s.coTeacherId === userId;

/** Is this lesson allowed in this period (and the one after it, for a double)? */
export function checkPlacement(data: PlanData, req: PlacementRequest): PlacementCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const a = data.assignments.get(req.assignmentId);
  const periods = byId(data.periods);
  const first = periods.get(req.periodId);
  if (!a) return { ok: false, errors: ['Assignment not found'], warnings, periodIds: [] };
  if (!first) return { ok: false, errors: ['Period not found'], warnings, periodIds: [] };
  const ignore = req.ignoreSlotIds ?? new Set<string>();
  const slots = data.slots.filter((s) => !ignore.has(s.id));

  const targets: PeriodInfo[] = [first];
  if (req.isDouble) {
    const d = secondOfDouble(data.periods, first);
    if (d.problem) errors.push(d.problem); else targets.push(d.second!);
  }
  for (const p of targets) if (p.type !== 'LESSON') errors.push(`${periodName(p)} is not a lesson period`);

  const mine = slots.filter((s) => s.assignmentId === a.id);
  const need = targets.length;
  if (mine.length + need > a.periodsPerWeek) {
    errors.push(`${a.subjectName} for ${a.targetName} has ${mine.length} of ${a.periodsPerWeek} periods placed already${need === 2 ? '; a double needs two more' : ''}`);
  }
  if (req.isDouble && a.doublesPerWeek === 0) errors.push(`${a.subjectName} for ${a.targetName} has no double periods. Add one to the teacher assignment first.`);
  else if (req.isDouble && mine.filter((s) => s.isDouble).length / 2 + 1 > a.doublesPerWeek) errors.push(`${a.subjectName} for ${a.targetName} already has all ${a.doublesPerWeek} of its double periods placed`);

  const room = req.roomId ? data.rooms.get(req.roomId) : undefined;
  if (req.roomId && !room) errors.push('Room not found');
  if (room && !room.active) errors.push(`${room.name} is not in use`);

  const audience: Audience = { classId: a.classId, groupId: a.groupId };
  for (const p of targets) {
    const here = slots.filter((s) => s.periodId === p.id);
    const who = (s: SlotInfo) => data.assignments.get(s.assignmentId);
    const people = [a.teacherId, a.coTeacherId].filter((x): x is string => !!x);
    for (const t of people) {
      const clash = here.find((s) => teachesIn(s, t) && s.assignmentId !== a.id);
      if (clash) errors.push(`${data.teacherNames.get(t) ?? 'The teacher'} already teaches ${who(clash)?.subjectName ?? 'another lesson'} to ${who(clash)?.targetName ?? ''} in ${periodName(p)}`);
    }
    const selfHere = here.find((s) => s.assignmentId === a.id);
    if (selfHere) errors.push(`${a.subjectName} for ${a.targetName} is already in ${periodName(p)}`);
    const busy = here.find((s) => s.assignmentId !== a.id && audiencesOverlap(data, audience, { classId: s.classId, groupId: s.groupId }));
    if (busy) errors.push(`${who(busy)?.targetName ?? 'The class'} already has ${who(busy)?.subjectName ?? 'a lesson'} in ${periodName(p)}`);
    if (room) {
      const roomClash = here.find((s) => s.roomId === room.id);
      if (roomClash) errors.push(`${room.name} is already used by ${who(roomClash)?.subjectName ?? 'another lesson'} for ${who(roomClash)?.targetName ?? ''} in ${periodName(p)}`);
    }
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  for (const day of Array.from(new Set(targets.map((t) => t.dayOfWeek)))) {
    const dayIds = new Set(dayPeriods(data.periods, day).map((p) => p.id));
    const sameDay = slots.filter((s) => dayIds.has(s.periodId) && s.assignmentId === a.id).length;
    if (sameDay > 0) warnings.push(`${a.subjectName} is already taught to ${a.targetName} on ${DAYS[day]}`);
  }
  if (a.isPractical && !(room && (LAB_TYPES as readonly string[]).includes(room.type))) {
    warnings.push(`${a.subjectName} is a practical subject and ${room ? `${room.name} is not a lab` : 'no lab is chosen'}`);
  }
  if (room && room.capacity < a.audienceSize) warnings.push(`${room.name} holds ${room.capacity} and ${a.targetName} has ${a.audienceSize} students`);
  for (const t of [a.teacherId, a.coTeacherId].filter((x): x is string => !!x)) {
    const off = data.unavailable.get(t);
    const name = data.teacherNames.get(t) ?? 'The teacher';
    if (off) {
      for (const p of targets) {
        if (off.has(p.id)) {
          const lessonIds = dayPeriods(data.periods, p.dayOfWeek).filter((x) => x.type === 'LESSON').map((x) => x.id);
          warnings.push(lessonIds.every((id) => off.has(id)) ? `${DAYS[p.dayOfWeek]} is ${name}'s free day` : `${name} is not available in ${periodName(p)}`);
        }
      }
    }
    // More than 4 lessons in a row for the teacher on that day.
    for (const day of Array.from(new Set(targets.map((x) => x.dayOfWeek)))) {
      const seq = dayPeriods(data.periods, day);
      const taught = new Set(slots.filter((s) => teachesIn(s, t)).map((s) => s.periodId));
      for (const p of targets) if (p.dayOfWeek === day) taught.add(p.id);
      let run = 0, longest = 0;
      for (const p of seq) { run = p.type === 'LESSON' && taught.has(p.id) ? run + 1 : 0; longest = Math.max(longest, run); }
      if (longest > MAX_IN_A_ROW) warnings.push(`${name} would teach ${longest} periods in a row on ${DAYS[day]}`);
    }
  }
  return { ok: errors.length === 0, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), periodIds: targets.map((t) => t.id) };
}

export interface Unplaced { assignmentId: string; subject: string; target: string; teacher: string; placed: number; needed: number; doublesPlaced: number; doublesNeeded: number }

/** For each assignment: periods placed against periods wanted (and doubles). */
export function placedReport(data: PlanData): Unplaced[] {
  const out: Unplaced[] = [];
  for (const a of Array.from(data.assignments.values())) {
    if (a.active === false) continue;
    const mine = data.slots.filter((s) => s.assignmentId === a.id);
    out.push({ assignmentId: a.id, subject: a.subjectName, target: a.targetName, teacher: a.teacherName, placed: mine.length, needed: a.periodsPerWeek, doublesPlaced: mine.filter((s) => s.isDouble).length / 2, doublesNeeded: a.doublesPerWeek });
  }
  return out;
}

/** Every clash among the lessons placed. Empty means the timetable can be taught. */
export function findClashes(data: PlanData): string[] {
  const out: string[] = [];
  const periods = byId(data.periods);
  const per = new Map<string, SlotInfo[]>();
  for (const s of data.slots) per.set(s.periodId, [...(per.get(s.periodId) ?? []), s]);
  for (const [pid, list] of Array.from(per)) {
    const p = periods.get(pid);
    const where = p ? periodName(p) : 'a period';
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!, y = list[j]!;
        const ax = data.assignments.get(x.assignmentId), ay = data.assignments.get(y.assignmentId);
        const people = [x.teacherId, x.coTeacherId].filter((t): t is string => !!t);
        const t = people.find((u) => teachesIn(y, u));
        if (t) out.push(`${data.teacherNames.get(t) ?? 'A teacher'} is in two lessons in ${where}`);
        if (audiencesOverlap(data, { classId: x.classId, groupId: x.groupId }, { classId: y.classId, groupId: y.groupId })) out.push(`${ax?.targetName ?? 'A class'} and ${ay?.targetName ?? 'another class'} share students in ${where}`);
        if (x.roomId && x.roomId === y.roomId) out.push(`${data.rooms.get(x.roomId)?.name ?? 'A room'} is used twice in ${where}`);
      }
    }
  }
  return Array.from(new Set(out));
}

export interface SuggestedSlot { periodId: string; free: boolean; reasons: string[]; warnings: string[] }

/** Every lesson period of the week with whether this lesson fits there without a clash (and why not). */
export function suggestSlots(data: PlanData, assignmentId: string, opts: { isDouble?: boolean; roomId?: string | null } = {}): SuggestedSlot[] {
  return data.periods
    .filter((p) => p.type === 'LESSON')
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start))
    .map((p) => {
      const r = checkPlacement(data, { assignmentId, periodId: p.id, isDouble: opts.isDouble, roomId: opts.roomId });
      return { periodId: p.id, free: r.ok, reasons: r.errors, warnings: r.warnings };
    });
}
