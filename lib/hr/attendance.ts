// Staff attendance. The school knows by 08:00 who is in, who is late and who is away. The office marks the day's register for everyone
// (all start Present, the exceptions are marked), or staff sign themselves in; approved leave fills itself in; a teacher who is absent
// or on leave appears in the Deputy's cover list with their lessons. Changes after the day need a reason and are logged.
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Employee, StaffAttStatus } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, fullName, hrHolds, idSchema, isoDateSchema, isoOf, loadHrSettings, monthRange, monthSchema, need, optText, ownEmployee, tellHolders, timeSchema, toDay, todayInHarare, type Actor } from '@/lib/hr/common';
import { workCalendar } from '@/lib/hr/calendar';
import { onLeaveOn } from '@/lib/hr/leave';
import { addDays } from '@/lib/academics/common';

export const ATT_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'OFFICIAL_DUTY', 'HALF_DAY'] as const;
const LEFT = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'];

/** Harare is UTC+2 all year. */
export function harareNow(now = new Date()): { date: string; time: string } {
  const h = new Date(now.getTime() + 2 * 3_600_000).toISOString();
  return { date: h.slice(0, 10), time: h.slice(11, 16) };
}

const lateAfterNow = (t: string, lateAfter: string) => t > lateAfter;

/** Who is expected on a day that is not a normal working day: staff on a published roster that day (weekend, boarding, sports). */
async function dutyStaffOn(tx: Db, schoolId: string, date: string): Promise<Set<string>> {
  const rows = await tx.dutyAssignment.findMany({ where: { schoolId, date: toDay(date) }, select: { employeeId: true, rosterId: true } });
  if (!rows.length) return new Set();
  const published = new Set((await tx.dutyRoster.findMany({ where: { schoolId, id: { in: rows.map((r) => r.rosterId) }, status: 'PUBLISHED' }, select: { id: true } })).map((r) => r.id));
  return new Set(rows.filter((r) => published.has(r.rosterId)).map((r) => r.employeeId));
}

// ─── The register ────────────────────────────────────────────────────────────

export interface RegisterRow { employeeId: string; employeeNo: string; name: string; jobTitle: string; department: string | null; status: StaffAttStatus; arrivalTime: string | null; saved: boolean; fromLeave: boolean; method: string | null; note: string | null }

export async function getRegister(user: Actor, date = todayInHarare()) {
  need(user, 'hr.attendance.mark', 'hr.attendance.view');
  isoDateSchema.parse(date);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const cal = await workCalendar(tx, user.schoolId, date, date);
    const working = cal.isWorkingDay(date);
    const dutyStaff = working ? new Set<string>() : await dutyStaffOn(tx, user.schoolId, date);
    const closedReason = working ? null : cal.holidayName(date) ? `Public holiday: ${cal.holidayName(date)}` : 'No register today (weekend, holiday or outside the term)';
    if (!working && dutyStaff.size === 0) return { date, working: false, closedReason, rows: [] as RegisterRow[], departments: [] as { id: string; name: string }[] };
    const [emps, rows, leave, depts, settings] = await Promise.all([
      tx.employee.findMany({ where: { schoolId: user.schoolId, startDate: { lte: toDay(date) }, OR: [{ leavingDate: null }, { leavingDate: { gte: toDay(date) } }] }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] }),
      tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, date: toDay(date) } }),
      onLeaveOn(tx, user.schoolId, date),
      tx.department.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      loadHrSettings(tx, user.schoolId),
    ]);
    void settings;
    const dOf = new Map(depts.map((d) => [d.id, d.name])), saved = new Map(rows.map((r) => [r.employeeId, r]));
    const out: RegisterRow[] = emps.filter((e) => working || dutyStaff.has(e.id)).map((e) => {
      const s = saved.get(e.id), l = leave.get(e.id);
      const status: StaffAttStatus = s?.status ?? (l ? (l.official ? 'OFFICIAL_DUTY' : 'ON_LEAVE') : 'PRESENT');
      return { employeeId: e.id, employeeNo: e.employeeNo, name: fullName(e), jobTitle: e.jobTitle, department: e.departmentId ? dOf.get(e.departmentId) ?? null : null, status, arrivalTime: s?.arrivalTime ?? null, saved: !!s, fromLeave: !s && !!l, method: s?.method ?? null, note: s?.note ?? null };
    });
    return { date, working: true, closedReason: null, rows: out, departments: depts };
  });
}

export const MarkSchema = z.object({
  date: isoDateSchema,
  // Everyone not listed is marked Present (the "everyone starts Present, tap exceptions" register); on-leave staff are filled in from approved leave.
  entries: z.array(z.object({ employeeId: idSchema, status: z.enum(ATT_STATUSES), arrivalTime: timeSchema.optional(), note: optText(200) })).max(1000).default([]),
  markRest: z.boolean().default(true),
  // Needed when the day has already passed.
  reason: z.string().trim().max(300).optional(),
});

/** Marks (or corrects) the day's register. Past days need hr.attendance.correct and a reason; every change to a saved row is logged. */
export async function markRegister(user: Actor, raw: unknown) {
  const v = MarkSchema.parse(raw);
  const today = todayInHarare();
  if (v.date > today) throw new ServiceError('You cannot mark a register for a day that has not come yet', 422);
  const past = v.date < today;
  if (past) need(user, 'hr.attendance.correct');
  else need(user, 'hr.attendance.mark', 'hr.attendance.correct');
  if (past && (!v.reason || v.reason.length < 3)) throw new ServiceError('Changes to a day that has passed need a reason', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadHrSettings(tx, user.schoolId);
    const cal = await workCalendar(tx, user.schoolId, v.date, v.date);
    const working = cal.isWorkingDay(v.date);
    const duty = working ? new Set<string>() : await dutyStaffOn(tx, user.schoolId, v.date);
    if (!working && duty.size === 0) throw new ServiceError(cal.holidayName(v.date) ? `There is no register on ${v.date} (public holiday: ${cal.holidayName(v.date)}).` : `There is no staff register on ${v.date} (weekend, holiday or outside the term).`, 409);
    const emps = (await tx.employee.findMany({ where: { schoolId: user.schoolId, startDate: { lte: toDay(v.date) }, OR: [{ leavingDate: null }, { leavingDate: { gte: toDay(v.date) } }] } })).filter((e) => working || duty.has(e.id));
    const byId = new Map(emps.map((e) => [e.id, e]));
    const leave = await onLeaveOn(tx, user.schoolId, v.date);
    const existing = new Map((await tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, date: toDay(v.date) } })).map((r) => [r.employeeId, r]));
    const given = new Map<string, (typeof v.entries)[number]>();
    for (const en of v.entries) {
      if (!byId.has(en.employeeId)) throw new ServiceError(working ? 'A person in the list is not on the staff register for this day' : 'Only staff on duty are on the register for this day', 422);
      given.set(en.employeeId, en);
    }
    const plan: { e: Employee; status: StaffAttStatus; arrival: string | null; note: string | null }[] = [];
    for (const e of emps) {
      const en = given.get(e.id), l = leave.get(e.id);
      if (!en && existing.has(e.id)) continue;               // already marked, not mentioned now
      if (!en && !v.markRest && !l) continue;
      let status: StaffAttStatus = en?.status ?? (l ? (l.official ? 'OFFICIAL_DUTY' : 'ON_LEAVE') : 'PRESENT');
      let arrival = en?.arrivalTime ?? null;
      if (status === 'ON_LEAVE' && !l) throw new ServiceError(`${fullName(e)} has no approved leave on ${v.date}`, 422);
      if (status === 'PRESENT' && arrival && lateAfterNow(arrival, settings.lateAfter)) status = 'LATE';
      if (status === 'LATE' && !arrival) throw new ServiceError(`Enter ${fullName(e)}'s arrival time`, 422);
      if (status === 'LATE' && arrival && !lateAfterNow(arrival, settings.lateAfter)) throw new ServiceError(`${fullName(e)} arrived at ${arrival}, which is not after ${settings.lateAfter}`, 422);
      if (!['PRESENT', 'LATE', 'HALF_DAY'].includes(status)) arrival = null;
      plan.push({ e, status, arrival, note: en?.note ?? null });
    }
    let created = 0, changed = 0;
    for (const p of plan) {
      const old = existing.get(p.e.id);
      if (old && old.status === p.status && old.arrivalTime === p.arrival) continue;
      if (old) {
        if (v.date === today && !past) { /* editing today's own register is not a correction */ }
        else if (!v.reason) throw new ServiceError('Changes to a day that has passed need a reason', 422);
        await tx.staffAttendance.update({ where: { id: old.id }, data: { status: p.status, arrivalTime: p.arrival, note: p.note, markedById: user.id } });
        if (past || v.reason) await tx.staffAttendanceChange.create({ data: { schoolId: user.schoolId, employeeId: p.e.id, date: toDay(v.date), oldStatus: old.status, newStatus: p.status, reason: v.reason ?? 'Corrected on the day', changedById: user.id } });
        changed++;
      } else {
        await tx.staffAttendance.create({ data: { schoolId: user.schoolId, employeeId: p.e.id, date: toDay(v.date), status: p.status, arrivalTime: p.arrival, note: p.note, markedById: user.id, method: 'OFFICE' } });
        if (past) await tx.staffAttendanceChange.create({ data: { schoolId: user.schoolId, employeeId: p.e.id, date: toDay(v.date), oldStatus: null, newStatus: p.status, reason: v.reason!, changedById: user.id } });
        created++;
      }
    }
    await audit(tx, user, past ? 'HR_CORRECT_ATTENDANCE' : 'HR_MARK_ATTENDANCE', 'StaffAttendance', v.date, `Staff register for ${v.date}: ${created} marked, ${changed} changed${v.reason ? ` (${v.reason})` : ''}`, undefined, { date: v.date, created, changed });
    for (const p of plan.filter((x) => x.status === 'ABSENT')) await checkAbsentRun(tx, user, settings.absentAlertDays, p.e, v.date);
    return { date: v.date, created, changed };
  });
}

/** Absent without approved leave for N working days in a row: HR and the Head are told (once per run of absence). */
async function checkAbsentRun(tx: Db, user: Actor, n: number, e: Employee, date: string) {
  const back = new Date(`${date}T00:00:00Z`);
  back.setUTCDate(back.getUTCDate() - 60);
  const cal = await workCalendar(tx, user.schoolId, isoOf(back), date);
  const days = cal.days(isoOf(back), date).slice(-n);
  if (days.length < n) return;
  const rows = await tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, employeeId: e.id, date: { in: days.map(toDay) } } });
  if (rows.length === n && rows.every((r) => r.status === 'ABSENT')) {
    const n1 = { title: `${fullName(e)} has been absent for ${n} days in a row`, body: `Without approved leave, up to ${date}`, link: `/hr/employees/${e.id}`, dedupeKey: `absent-run:${e.id}:${days[0]}` };
    await tellHolders(tx, user, 'hr.attendance.correct', n1);
    await tellHolders(tx, user, 'hr.posts.approve', n1);
  }
}

// ─── Signing in ──────────────────────────────────────────────────────────────

async function signInFor(tx: Db, actor: Actor, e: Employee, method: 'SELF' | 'TABLET', now: Date) {
  const settings = await loadHrSettings(tx, actor.schoolId);
  const { date, time } = harareNow(now);
  if (method === 'SELF' && !settings.selfSignIn) throw new ServiceError('Signing in from your phone is not switched on at this school. Ask the office to mark you in.', 409);
  if (method === 'TABLET' && !settings.tabletSignIn) throw new ServiceError('The office tablet is not switched on at this school', 409);
  if (LEFT.includes(e.status)) throw new ServiceError('This person has left', 409);
  const cal = await workCalendar(tx, actor.schoolId, date, date);
  if (!cal.isWorkingDay(date) && !(await dutyStaffOn(tx, actor.schoolId, date)).has(e.id)) throw new ServiceError('There is no register today', 409);
  if (time < settings.signInFrom || time > settings.signInUntil) throw new ServiceError(`You can sign in between ${settings.signInFrom} and ${settings.signInUntil}`, 409);
  const existing = await tx.staffAttendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date: toDay(date) } } });
  if (existing) throw new ServiceError(existing.arrivalTime ? `You are already signed in (${existing.arrivalTime}).` : `You are already marked ${existing.status.toLowerCase().replace('_', ' ')} today.`, 409);
  const status: StaffAttStatus = lateAfterNow(time, settings.lateAfter) ? 'LATE' : 'PRESENT';
  const row = await tx.staffAttendance.create({ data: { schoolId: actor.schoolId, employeeId: e.id, date: toDay(date), status, arrivalTime: time, method, markedById: actor.id } });
  await audit(tx, actor, 'HR_SIGN_IN', 'StaffAttendance', row.id, `${fullName(e)} signed in at ${time} (${status.toLowerCase()})`, undefined, { status, time, method });
  return { date, time, status };
}

/** A staff member taps "Sign in" on their phone. */
export async function selfSignIn(user: Actor, now = new Date()) {
  need(user, 'hr.attendance.self');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await ownEmployee(tx, user);
    if (!e) throw new ServiceError('You have no staff record yet. Ask HR to link your login to it.', 404);
    return signInFor(tx, user, e, 'SELF', now);
  });
}

export const TabletSchema = z.object({ employeeNo: z.string().trim().min(3).max(20), pin: z.string().regex(/^\d{4}$/, 'The PIN is 4 digits') });
const MAX_PIN_TRIES = 5;

/** The shared office tablet: staff without a phone enter their employee number and 4-digit PIN. The signed-in user is the office. */
export async function tabletSignIn(user: Actor, raw: unknown, now = new Date()) {
  need(user, 'hr.attendance.mark');
  const v = TabletSchema.parse(raw);
  const outcome = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.employee.findFirst({ where: { schoolId: user.schoolId, employeeNo: v.employeeNo.toUpperCase() } });
    // The same answer for "no such number" and "wrong PIN", so the tablet does not confirm who works here.
    const bad = new ServiceError('That employee number and PIN do not match', 403);
    if (!e || !e.tabletPinHash) throw bad;
    const recent = await tx.staffAttendanceChange.count({ where: { schoolId: user.schoolId, employeeId: e.id, reason: 'WRONG_PIN', createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } } });
    if (recent >= MAX_PIN_TRIES) throw new ServiceError('Too many wrong PINs. Ask the office to mark you in.', 429);
    if (!(await bcrypt.compare(v.pin, e.tabletPinHash))) {
      // Kept (not rolled back) so that five wrong tries in 15 minutes lock the tablet for this person.
      await tx.staffAttendanceChange.create({ data: { schoolId: user.schoolId, employeeId: e.id, date: toDay(harareNow(now).date), oldStatus: null, newStatus: 'WRONG_PIN', reason: 'WRONG_PIN', changedById: user.id } });
      return null;
    }
    return signInFor(tx, user, e, 'TABLET', now);
  });
  if (!outcome) throw new ServiceError('That employee number and PIN do not match', 403);
  return outcome;
}

export const SetPinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, 'The PIN is 4 digits') });

export async function setTabletPin(user: Actor, employeeId: string, raw: unknown) {
  need(user, 'hr.employees.manage');
  const { pin } = SetPinSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.employee.findFirst({ where: { id: employeeId, schoolId: user.schoolId } });
    if (!e) throw new ServiceError('Employee not found', 404);
    await tx.employee.update({ where: { id: employeeId }, data: { tabletPinHash: await bcrypt.hash(pin, 10) } });
    await audit(tx, user, 'HR_SAVE_EMPLOYEE', 'Employee', employeeId, `Set the tablet PIN of ${fullName(e)}`);
    return { id: employeeId };
  });
}

/** End-of-day sign-out (optional). */
export async function selfSignOut(user: Actor, now = new Date()) {
  need(user, 'hr.attendance.self');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await ownEmployee(tx, user);
    if (!e) throw new ServiceError('You have no staff record yet.', 404);
    const { date, time } = harareNow(now);
    const row = await tx.staffAttendance.findUnique({ where: { employeeId_date: { employeeId: e.id, date: toDay(date) } } });
    if (!row) throw new ServiceError('You have not signed in today', 409);
    if (row.departureTime) throw new ServiceError(`You signed out at ${row.departureTime} already`, 409);
    await tx.staffAttendance.update({ where: { id: row.id }, data: { departureTime: time } });
    return { date, time };
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

/** The morning summary: present, late, absent, away by department. */
export async function dailySummary(user: Actor, date = todayInHarare()) {
  need(user, 'hr.attendance.view', 'hr.attendance.mark');
  const reg = await getRegister(user, date);
  const depts = new Map(reg.departments.map((d) => [d.name, 0]));
  void depts;
  const by: Record<string, Record<string, number>> = {};
  const total: Record<string, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, OFFICIAL_DUTY: 0, HALF_DAY: 0 };
  for (const r of reg.rows) {
    const k = r.department ?? 'No department';
    by[k] ??= { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, OFFICIAL_DUTY: 0, HALF_DAY: 0 };
    by[k]![r.status]!++;
    total[r.status]!++;
  }
  return { date, working: reg.working, closedReason: reg.closedReason, total, byDepartment: by, people: reg.rows.length, unmarked: reg.rows.filter((r) => !r.saved && !r.fromLeave).length };
}

export async function monthlyAttendance(user: Actor, month: string) {
  need(user, 'hr.attendance.view');
  monthSchema.parse(month);
  const { first, last } = monthRange(month);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [emps, rows, cal] = await Promise.all([
      tx.employee.findMany({ where: { schoolId: user.schoolId, startDate: { lte: toDay(last) }, OR: [{ leavingDate: null }, { leavingDate: { gte: toDay(first) } }] }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] }),
      tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, date: { gte: toDay(first), lte: toDay(last) } } }),
      workCalendar(tx, user.schoolId, first, last),
    ]);
    const workDays = cal.days(first, last).length;
    return {
      month, workingDays: workDays,
      rows: emps.map((e) => {
        const mine = rows.filter((r) => r.employeeId === e.id);
        const count = (s: StaffAttStatus) => mine.filter((r) => r.status === s).length;
        const present = count('PRESENT') + count('LATE') + count('OFFICIAL_DUTY') + count('HALF_DAY') * 0.5;
        return { employeeId: e.id, name: fullName(e), daysPresent: present, late: count('LATE'), absent: count('ABSENT'), onLeave: count('ON_LEAVE'), halfDays: count('HALF_DAY'), official: count('OFFICIAL_DUTY'), rate: workDays ? Math.round((present / workDays) * 1000) / 10 : null };
      }),
    };
  });
}

/** Late arrivals per week over a period, to see whether lateness is growing. */
export async function latenessTrend(user: Actor, raw: { from: string; to: string }) {
  need(user, 'hr.attendance.view');
  const v = z.object({ from: isoDateSchema, to: isoDateSchema }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, status: 'LATE', date: { gte: toDay(v.from), lte: toDay(v.to) } }, select: { date: true } });
    const weeks = new Map<string, number>();
    for (const r of rows) {
      const d = isoOf(r.date);
      const wd = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7);
      const monday = addDays(d, -wd);
      weeks.set(monday, (weeks.get(monday) ?? 0) + 1);
    }
    return Array.from(weeks.entries()).sort().map(([weekStart, late]) => ({ weekStart, late }));
  });
}

// ─── Cover list ──────────────────────────────────────────────────────────────

/** Teachers (logins) who are absent or on leave on a day, from the register and from approved leave. */
export async function absentTeacherUserIds(tx: Db, schoolId: string, date: string): Promise<string[]> {
  const [rows, leave, emps] = await Promise.all([
    tx.staffAttendance.findMany({ where: { schoolId, date: toDay(date), status: { in: ['ABSENT', 'ON_LEAVE'] } }, select: { employeeId: true } }),
    onLeaveOn(tx, schoolId, date),
    tx.employee.findMany({ where: { schoolId, userId: { not: null }, status: { notIn: ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] } }, select: { id: true, userId: true } }),
  ]);
  const away = new Set([...rows.map((r) => r.employeeId), ...Array.from(leave.entries()).filter(([, l]) => !l.official).map(([id]) => id)]);
  // A teacher who is on the register as present (even with leave on file) is not absent.
  const present = new Set((await tx.staffAttendance.findMany({ where: { schoolId, date: toDay(date), status: { in: ['PRESENT', 'LATE', 'HALF_DAY', 'OFFICIAL_DUTY'] } }, select: { employeeId: true } })).map((r) => r.employeeId));
  return emps.filter((e) => away.has(e.id) && !present.has(e.id)).map((e) => e.userId!);
}

/** The Deputy's list for a day: who is away, and the lessons that need cover (from Academics). */
export async function coverList(user: Actor, date = todayInHarare()) {
  if (!hrHolds(user, 'hr.attendance.view') && !hrHolds(user, 'hr.duties.manage')) need(user, 'hr.attendance.view');
  const { coverCandidates } = await import('@/lib/academics/timetable');
  const absent = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const ids = await absentTeacherUserIds(tx, user.schoolId, date);
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, userId: { in: ids }, category: 'TEACHING' } });
    const reg = await tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, date: toDay(date), employeeId: { in: emps.map((e) => e.id) } } });
    return emps.map((e) => ({ employeeId: e.id, userId: e.userId!, name: fullName(e, true), status: reg.find((r) => r.employeeId === e.id)?.status ?? 'ON_LEAVE' }));
  });
  const out = [];
  for (const a of absent) {
    let lessons: unknown = [];
    try {
      lessons = (await coverCandidates(user, { date, absentTeacherId: a.userId } as never) as { lessons?: unknown }).lessons ?? [];
    } catch (e) {
      lessons = e instanceof ServiceError ? { note: e.message } : [];
    }
    out.push({ ...a, lessons });
  }
  return { date, absent: out };
}


/** Your own sign-in history for a month and how often you were late. */
export async function myAttendance(user: Actor, month = todayInHarare().slice(0, 7)) {
  need(user, 'hr.attendance.self');
  monthSchema.parse(month);
  const { first, last } = monthRange(month);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await ownEmployee(tx, user);
    if (!e) return { month, rows: [], late: 0, absent: 0 };
    const rows = await tx.staffAttendance.findMany({ where: { schoolId: user.schoolId, employeeId: e.id, date: { gte: toDay(first), lte: toDay(last) } }, orderBy: { date: 'desc' } });
    return { month, rows: rows.map((r) => ({ date: isoOf(r.date), status: r.status, arrivalTime: r.arrivalTime, departureTime: r.departureTime, method: r.method })), late: rows.filter((r) => r.status === 'LATE').length, absent: rows.filter((r) => r.status === 'ABSENT').length };
  });
}
