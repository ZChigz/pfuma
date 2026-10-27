// The duty roster. The Deputy fills a grid of duties (days across, duty types down), the Head approves it, and it is published: staff
// see their own duties and get a reminder the evening before. Auto-fill spreads duties evenly across eligible staff and skips people on
// approved leave. Swaps: the colleague accepts, the Deputy confirms. A published roster is not rearranged, only swapped.
import { z } from 'zod';
import type { Employee, EmployeeCategory } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import * as guards from '@/lib/access/guards';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, daysBetween, fullName, hrHolds, idSchema, isoDateSchema, isoOf, need, optText, ownEmployee, tellEmployee, tellHolders, toDay, todayInHarare, type Actor } from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { workCalendar } from '@/lib/hr/calendar';
import { onLeaveOn } from '@/lib/hr/leave';
import { addDays, weekdayOf } from '@/lib/academics/common';
import { notifyUsers } from '@/lib/system/notifications';

const CATEGORIES = ['TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS'] as const;
const LEFT = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'];
export const MAX_ROSTER_DAYS = 160;

export async function listDutyTypes(user: Actor) {
  need(user, 'hr.duties.view', 'hr.duties.manage', 'hr.duties.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    return tx.dutyType.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  });
}

export const DutyTypeSchema = z.object({
  id: idSchema.optional(), name: z.string().trim().min(2).max(60), wholeDay: z.boolean().default(false), eligibleCategories: z.array(z.enum(CATEGORIES)).default([]),
  perDay: z.number().int().min(1).max(20).default(1), active: z.boolean().default(true),
});

export async function saveDutyType(user: Actor, raw: unknown) {
  need(user, 'hr.duties.manage');
  const { id, ...v } = DutyTypeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const clash = await tx.dutyType.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
    if (clash) throw new ServiceError('There is already a duty with this name', 409);
    let row;
    if (id) {
      if (!(await tx.dutyType.findFirst({ where: { id, schoolId: user.schoolId } }))) throw new ServiceError('Duty type not found', 404);
      row = await tx.dutyType.update({ where: { id }, data: v });
    } else row = await tx.dutyType.create({ data: { schoolId: user.schoolId, sortOrder: 99, ...v } });
    await audit(tx, user, 'HR_SAVE_DUTY_TYPE', 'DutyType', row.id, `${id ? 'Changed' : 'Added'} duty type ${v.name}`, undefined, v);
    return { id: row.id };
  });
}

export const RosterSchema = z.object({ label: z.string().trim().min(2).max(80), startDate: isoDateSchema, endDate: isoDateSchema })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'The end date is before the start date' })
  .refine((v) => daysBetween(v.startDate, v.endDate) <= MAX_ROSTER_DAYS, { path: ['endDate'], message: `A roster covers at most ${MAX_ROSTER_DAYS} days (a term)` });

export async function createRoster(user: Actor, raw: unknown) {
  need(user, 'hr.duties.manage');
  const v = RosterSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.dutyRoster.create({ data: { schoolId: user.schoolId, label: v.label, startDate: toDay(v.startDate), endDate: toDay(v.endDate), createdById: user.id } });
    await audit(tx, user, 'HR_SAVE_ROSTER', 'DutyRoster', r.id, `Started the duty roster "${v.label}", ${v.startDate} to ${v.endDate}`, undefined, v);
    return { id: r.id };
  });
}

export async function listRosters(user: Actor) {
  need(user, 'hr.duties.view', 'hr.duties.manage', 'hr.duties.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.dutyRoster.findMany({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, label: r.label, startDate: isoOf(r.startDate), endDate: isoOf(r.endDate), status: r.status, createdById: r.createdById, approvedById: r.approvedById, publishedAt: r.publishedAt?.toISOString() ?? null }));
  });
}

/** The grid: assignments by duty type and day, and how many duties each person has (the most and least loaded are marked). */
export async function getRoster(user: Actor, id: string) {
  need(user, 'hr.duties.view', 'hr.duties.manage', 'hr.duties.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.dutyRoster.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Roster not found', 404);
    const [types, rows] = await Promise.all([
      tx.dutyType.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      tx.dutyAssignment.findMany({ where: { schoolId: user.schoolId, rosterId: id }, orderBy: { date: 'asc' } }),
    ]);
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: LEFT as never[] } }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] });
    const eOf = new Map(emps.map((e) => [e.id, e]));
    const counts = new Map<string, number>();
    for (const a of rows) counts.set(a.employeeId, (counts.get(a.employeeId) ?? 0) + 1);
    // Fairness is measured over the people who could be given duties: everyone who has one, plus active teaching and boarding staff.
    const pool = emps.filter((e) => counts.has(e.id) || e.category === 'TEACHING' || e.category === 'BOARDING');
    const loads = pool.map((e) => ({ employeeId: e.id, name: fullName(e), category: e.category, count: counts.get(e.id) ?? 0 }));
    const max = Math.max(0, ...loads.map((l) => l.count)), min = loads.length ? Math.min(...loads.map((l) => l.count)) : 0;
    return {
      id: r.id, label: r.label, startDate: isoOf(r.startDate), endDate: isoOf(r.endDate), status: r.status, createdById: r.createdById, approvedById: r.approvedById, publishedAt: r.publishedAt?.toISOString() ?? null,
      types: types.map((t) => ({ id: t.id, name: t.name, perDay: t.perDay, wholeDay: t.wholeDay })),
      assignments: rows.map((a) => ({ id: a.id, dutyTypeId: a.dutyTypeId, date: isoOf(a.date), employeeId: a.employeeId, employee: eOf.get(a.employeeId) ? fullName(eOf.get(a.employeeId) as Employee) : '?', note: a.note })),
      fairness: loads.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((l) => ({ ...l, most: max > min && l.count === max, least: max > min && l.count === min })),
    };
  });
}

async function loadDraft(tx: Db, schoolId: string, id: string) {
  const r = await tx.dutyRoster.findFirst({ where: { id, schoolId } });
  if (!r) throw new ServiceError('Roster not found', 404);
  if (r.status !== 'DRAFT') throw new ServiceError(`This roster is ${r.status.toLowerCase()} and its duties cannot be rearranged. Use a swap.`, 409);
  return r;
}

export const AssignSchema = z.object({ dutyTypeId: idSchema, date: isoDateSchema, employeeId: idSchema, note: optText(200) });

async function placeDuty(tx: Db, user: Actor, roster: { id: string; startDate: Date; endDate: Date }, v: z.infer<typeof AssignSchema>, leave: Map<string, unknown>, e: Employee, typeName: string, eligible: EmployeeCategory[]) {
  if (v.date < isoOf(roster.startDate) || v.date > isoOf(roster.endDate)) throw new ServiceError('That day is outside the roster', 422);
  if (LEFT.includes(e.status)) throw new ServiceError(`${fullName(e)} has left`, 409);
  if (eligible.length && !eligible.includes(e.category)) throw new ServiceError(`${fullName(e)} (${e.category.toLowerCase()}) is not eligible for ${typeName}`, 422);
  if (leave.has(e.id)) throw new ServiceError(`${fullName(e)} is on approved leave on ${v.date}`, 409);
  return tx.dutyAssignment.create({ data: { schoolId: user.schoolId, rosterId: roster.id, dutyTypeId: v.dutyTypeId, date: toDay(v.date), employeeId: v.employeeId, note: v.note ?? null } });
}

export async function assignDuty(user: Actor, rosterId: string, raw: unknown) {
  need(user, 'hr.duties.manage');
  const v = AssignSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const roster = await loadDraft(tx, user.schoolId, rosterId);
    const type = await tx.dutyType.findFirst({ where: { id: v.dutyTypeId, schoolId: user.schoolId, active: true } });
    if (!type) throw new ServiceError('Duty type not found', 404);
    const e = await tx.employee.findFirst({ where: { id: v.employeeId, schoolId: user.schoolId } });
    if (!e) throw new ServiceError('Employee not found', 404);
    if (await tx.dutyAssignment.findFirst({ where: { rosterId, dutyTypeId: v.dutyTypeId, date: toDay(v.date), employeeId: v.employeeId }, select: { id: true } })) throw new ServiceError(`${fullName(e)} already has this duty on ${v.date}`, 409);
    const row = await placeDuty(tx, user, roster, v, await onLeaveOn(tx, user.schoolId, v.date), e, type.name, type.eligibleCategories);
    await audit(tx, user, 'HR_SAVE_ROSTER', 'DutyAssignment', row.id, `${fullName(e)}: ${type.name} on ${v.date}`, undefined, { dutyType: type.name, date: v.date });
    return { id: row.id };
  });
}

export async function removeDuty(user: Actor, assignmentId: string) {
  need(user, 'hr.duties.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.dutyAssignment.findFirst({ where: { id: assignmentId, schoolId: user.schoolId } });
    if (!a) throw new ServiceError('Duty not found', 404);
    await loadDraft(tx, user.schoolId, a.rosterId);
    await tx.dutyAssignment.delete({ where: { id: assignmentId } });
    await audit(tx, user, 'HR_SAVE_ROSTER', 'DutyAssignment', assignmentId, `Removed a duty on ${isoOf(a.date)}`, { date: isoOf(a.date), employeeId: a.employeeId }, undefined);
    return { id: assignmentId };
  });
}

/** Which days a duty type is filled on: weekend duty on weekends, boarding-only duties (dormitory) every day, the rest on working days. */
function dutyDays(type: { name: string; eligibleCategories: EmployeeCategory[] }, from: string, to: string, working: (d: string) => boolean): string[] {
  const out: string[] = [];
  const weekendOnly = /weekend/i.test(type.name);
  const everyDay = type.eligibleCategories.length > 0 && type.eligibleCategories.every((c) => c === 'BOARDING');
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (weekendOnly ? wd >= 6 : everyDay ? true : working(d)) out.push(d);
  }
  return out;
}

export const AutoFillSchema = z.object({ dutyTypeIds: z.array(idSchema).optional() });

/**
 * Spreads duties evenly: for each duty and day it picks the eligible person with the fewest duties so far who is not on approved leave
 * and does not already have a duty that day. Exam invigilation is not auto-filled (it comes from Examinations). Existing duties stay.
 */
export async function autoFillRoster(user: Actor, rosterId: string, raw: unknown = {}) {
  need(user, 'hr.duties.manage');
  const v = AutoFillSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const roster = await loadDraft(tx, user.schoolId, rosterId);
    const from = isoOf(roster.startDate), to = isoOf(roster.endDate);
    const types = (await tx.dutyType.findMany({ where: { schoolId: user.schoolId, active: true, ...(v.dutyTypeIds ? { id: { in: v.dutyTypeIds } } : {}) }, orderBy: [{ sortOrder: 'asc' }] })).filter((t) => !/invigilation/i.test(t.name));
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: LEFT as never[] } }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }] });
    const cal = await workCalendar(tx, user.schoolId, from, to);
    const existing = await tx.dutyAssignment.findMany({ where: { schoolId: user.schoolId, rosterId } });
    const load = new Map<string, number>();
    const busy = new Map<string, Set<string>>(); // date -> employees with a duty
    const have = new Map<string, number>();       // type|date -> how many placed
    for (const a of existing) {
      load.set(a.employeeId, (load.get(a.employeeId) ?? 0) + 1);
      busy.set(isoOf(a.date), (busy.get(isoOf(a.date)) ?? new Set()).add(a.employeeId));
      have.set(`${a.dutyTypeId}|${isoOf(a.date)}`, (have.get(`${a.dutyTypeId}|${isoOf(a.date)}`) ?? 0) + 1);
    }
    const leaves = await tx.leaveRequest.findMany({ where: { schoolId: user.schoolId, status: 'APPROVED', startDate: { lte: toDay(to) }, endDate: { gte: toDay(from) } } });
    const awayOn = (empId: string, d: string) => leaves.some((l) => l.employeeId === empId && isoOf(l.startDate) <= d && d <= isoOf(l.endDate));
    let placed = 0;
    const unfilled: { duty: string; date: string; missing: number }[] = [];
    for (const t of types) {
      const pool = emps.filter((e) => (t.eligibleCategories.length ? t.eligibleCategories.includes(e.category) : e.category === 'TEACHING'));
      for (const d of dutyDays(t, from, to, cal.isWorkingDay)) {
        let need1 = t.perDay - (have.get(`${t.id}|${d}`) ?? 0);
        while (need1 > 0) {
          const pick = pool.filter((e) => !awayOn(e.id, d) && !(busy.get(d)?.has(e.id))).sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.surname.localeCompare(b.surname))[0];
          if (!pick) break;
          await tx.dutyAssignment.create({ data: { schoolId: user.schoolId, rosterId, dutyTypeId: t.id, date: toDay(d), employeeId: pick.id } });
          load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
          busy.set(d, (busy.get(d) ?? new Set()).add(pick.id));
          placed++; need1--;
        }
        if (need1 > 0) unfilled.push({ duty: t.name, date: d, missing: need1 });
      }
    }
    await audit(tx, user, 'HR_SAVE_ROSTER', 'DutyRoster', rosterId, `Auto-filled the roster: ${placed} duties placed, ${unfilled.length} slots could not be filled`, undefined, { placed, unfilled: unfilled.length });
    return { placed, unfilled };
  });
}

/** Copies the invigilation duties set in Examinations onto the roster, as "Exam invigilation" on the paper's date. */
export async function importInvigilation(user: Actor, rosterId: string) {
  need(user, 'hr.duties.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const roster = await loadDraft(tx, user.schoolId, rosterId);
    const type = await tx.dutyType.findFirst({ where: { schoolId: user.schoolId, name: 'Exam invigilation' } });
    if (!type) throw new ServiceError('Add a duty type called "Exam invigilation" first', 409);
    const rows = await tx.invigilation.findMany({ where: { schoolId: user.schoolId, paper: { date: { gte: roster.startDate, lte: roster.endDate } } }, include: { paper: { select: { date: true } } } });
    const emps = new Map((await tx.employee.findMany({ where: { schoolId: user.schoolId, userId: { in: rows.map((r) => r.userId) } } })).map((e) => [e.userId!, e]));
    let added = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      const e = emps.get(r.userId);
      if (!e) { skipped.push(r.userId); continue; }
      const date = isoOf(r.paper.date);
      if (await tx.dutyAssignment.findFirst({ where: { rosterId, dutyTypeId: type.id, date: toDay(date), employeeId: e.id }, select: { id: true } })) continue;
      await tx.dutyAssignment.create({ data: { schoolId: user.schoolId, rosterId, dutyTypeId: type.id, date: toDay(date), employeeId: e.id } });
      added++;
    }
    await audit(tx, user, 'HR_SAVE_ROSTER', 'DutyRoster', rosterId, `Imported ${added} invigilation duties from Examinations`, undefined, { added, withoutStaffRecord: skipped.length });
    return { added, withoutStaffRecord: skipped.length };
  });
}

// ─── Approval and publishing ─────────────────────────────────────────────────

export async function approveRoster(user: Actor, id: string) {
  need(user, 'hr.duties.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.dutyRoster.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Roster not found', 404);
    if (r.status !== 'DRAFT') throw new ServiceError(`This roster is ${r.status.toLowerCase()} already`, 409);
    if (r.createdById === user.id) throw new ServiceError('You built this roster, so someone else must approve it.', 403);
    if ((await tx.dutyAssignment.count({ where: { rosterId: id } })) === 0) throw new ServiceError('The roster is empty', 409);
    await tx.dutyRoster.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() } });
    await audit(tx, user, 'HR_APPROVE_ROSTER', 'DutyRoster', id, `Approved the roster "${r.label}"`, { status: 'DRAFT' }, { status: 'APPROVED' });
    await tellHolders(tx, user, 'hr.duties.manage', { title: `The roster "${r.label}" was approved`, body: 'You can publish it.', link: `/hr/duties/${id}` });
    return { id, status: 'APPROVED' as const };
  });
}

export async function publishRoster(user: Actor, id: string) {
  need(user, 'hr.duties.approve', 'hr.duties.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.dutyRoster.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Roster not found', 404);
    if (r.status !== 'APPROVED') throw new ServiceError(r.status === 'PUBLISHED' ? 'This roster is published already' : 'The Head must approve the roster before it is published', 409);
    await tx.dutyRoster.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    const rows = await tx.dutyAssignment.findMany({ where: { rosterId: id } });
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: Array.from(new Set(rows.map((a) => a.employeeId))) } } });
    for (const e of emps) {
      const mine = rows.filter((a) => a.employeeId === e.id);
      await tellEmployee(tx, user.schoolId, e, { title: 'The duty roster is published', body: `You have ${mine.length} duties in "${r.label}".`, link: '/hr/me/duties', dedupeKey: `roster:${id}` });
    }
    await audit(tx, user, 'HR_PUBLISH_ROSTER', 'DutyRoster', id, `Published the roster "${r.label}"`, { status: 'APPROVED' }, { status: 'PUBLISHED' });
    return { id, status: 'PUBLISHED' as const, told: emps.length };
  });
}

/** Run once a day in the evening: everyone with a duty tomorrow is reminded (once, however often this runs). */
export async function sendDutyReminders(tx: Db, schoolId: string, today = todayInHarare()) {
  const tomorrow = addDays(today, 1);
  const rows = await tx.dutyAssignment.findMany({ where: { schoolId, date: toDay(tomorrow) } });
  if (!rows.length) return 0;
  const live = new Set((await tx.dutyRoster.findMany({ where: { schoolId, id: { in: rows.map((r) => r.rosterId) }, status: 'PUBLISHED' }, select: { id: true } })).map((r) => r.id));
  const types = new Map((await tx.dutyType.findMany({ where: { schoolId } })).map((t) => [t.id, t.name]));
  const emps = new Map((await tx.employee.findMany({ where: { schoolId, id: { in: rows.map((r) => r.employeeId) } } })).map((e) => [e.id, e]));
  let n = 0;
  for (const a of rows.filter((r) => live.has(r.rosterId))) {
    const e = emps.get(a.employeeId);
    if (!e?.userId) continue;
    n += await notifyUsers(tx, schoolId, [e.userId], { type: 'HR', title: `Duty tomorrow: ${types.get(a.dutyTypeId) ?? 'duty'}`, body: tomorrow, link: '/hr/me/duties', dedupeKey: `duty-remind:${a.id}` });
  }
  return n;
}

// ─── Own duties and swaps ────────────────────────────────────────────────────

export async function myDuties(user: Actor, from = todayInHarare()) {
  need(user, 'hr.self.details');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await ownEmployee(tx, user);
    if (!e) return [];
    const rosters = await tx.dutyRoster.findMany({ where: { schoolId: user.schoolId, status: 'PUBLISHED' }, select: { id: true } });
    const rows = await tx.dutyAssignment.findMany({ where: { schoolId: user.schoolId, employeeId: e.id, rosterId: { in: rosters.map((r) => r.id) }, date: { gte: toDay(from) } }, orderBy: { date: 'asc' }, take: 100 });
    const types = new Map((await tx.dutyType.findMany({ where: { schoolId: user.schoolId } })).map((t) => [t.id, t.name]));
    const swaps = await tx.dutySwap.findMany({ where: { schoolId: user.schoolId, assignmentId: { in: rows.map((r) => r.id) }, status: { in: ['REQUESTED', 'ACCEPTED'] } } });
    return rows.map((a) => ({ id: a.id, date: isoOf(a.date), duty: types.get(a.dutyTypeId) ?? '?', note: a.note, swap: swaps.find((s) => s.assignmentId === a.id)?.status ?? null }));
  });
}

export const SwapRequestSchema = z.object({ assignmentId: idSchema, toEmployeeId: idSchema, reason: optText(300) });

export async function requestSwap(user: Actor, raw: unknown) {
  need(user, 'hr.self.details');
  const v = SwapRequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    if (!me) throw new ServiceError('You have no staff record yet.', 404);
    const a = await tx.dutyAssignment.findFirst({ where: { id: v.assignmentId, schoolId: user.schoolId } });
    if (!a || a.employeeId !== me.id) throw new ServiceError('That is not your duty', 403);
    const roster = await tx.dutyRoster.findFirstOrThrow({ where: { id: a.rosterId } });
    if (roster.status !== 'PUBLISHED') throw new ServiceError('Duties can be swapped once the roster is published', 409);
    if (isoOf(a.date) < todayInHarare()) throw new ServiceError('That duty has passed', 409);
    const to = await tx.employee.findFirst({ where: { id: v.toEmployeeId, schoolId: user.schoolId } });
    if (!to || to.id === me.id) throw new ServiceError('Choose a colleague', 422);
    if (LEFT.includes(to.status)) throw new ServiceError(`${fullName(to)} has left`, 409);
    if (await tx.dutySwap.findFirst({ where: { assignmentId: a.id, status: { in: ['REQUESTED', 'ACCEPTED'] } }, select: { id: true } })) throw new ServiceError('There is a swap waiting for this duty already', 409);
    if (await tx.dutyAssignment.findFirst({ where: { rosterId: a.rosterId, dutyTypeId: a.dutyTypeId, date: a.date, employeeId: to.id }, select: { id: true } })) throw new ServiceError(`${fullName(to)} already has this duty that day`, 409);
    if ((await onLeaveOn(tx, user.schoolId, isoOf(a.date))).has(to.id)) throw new ServiceError(`${fullName(to)} is on leave that day`, 409);
    const s = await tx.dutySwap.create({ data: { schoolId: user.schoolId, assignmentId: a.id, fromEmployeeId: me.id, toEmployeeId: to.id, reason: v.reason ?? null } });
    await audit(tx, user, 'HR_SWAP_DUTY', 'DutySwap', s.id, `${fullName(me)} asked ${fullName(to)} to take their duty on ${isoOf(a.date)}`, undefined, { date: isoOf(a.date) });
    await tellEmployee(tx, user.schoolId, to, { title: `${fullName(me)} asked you to take a duty`, body: isoOf(a.date), link: '/hr/me/duties' });
    return { id: s.id };
  });
}

export const SwapReplySchema = z.object({ accept: z.boolean() });

/** The colleague answers. If they accept, the Deputy is asked to confirm. */
export async function replySwap(user: Actor, swapId: string, raw: unknown) {
  need(user, 'hr.self.details');
  const v = SwapReplySchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    const s = await tx.dutySwap.findFirst({ where: { id: swapId, schoolId: user.schoolId } });
    if (!s || !me || s.toEmployeeId !== me.id) throw new ServiceError('Swap not found', 404);
    if (s.status !== 'REQUESTED') throw new ServiceError('This swap has been answered already', 409);
    await tx.dutySwap.update({ where: { id: swapId }, data: { status: v.accept ? 'ACCEPTED' : 'DECLINED' } });
    const from = await tx.employee.findFirst({ where: { id: s.fromEmployeeId, schoolId: user.schoolId } });
    if (from) await tellEmployee(tx, user.schoolId, from, { title: v.accept ? 'Your duty swap was accepted' : 'Your duty swap was declined', body: v.accept ? 'The Deputy will confirm it.' : undefined, link: '/hr/me/duties' });
    if (v.accept) await tellHolders(tx, user, 'hr.duties.manage', { title: 'A duty swap waits for your confirmation', link: '/hr/duties' });
    await audit(tx, user, 'HR_SWAP_DUTY', 'DutySwap', swapId, v.accept ? 'Accepted a duty swap' : 'Declined a duty swap', { status: s.status }, { status: v.accept ? 'ACCEPTED' : 'DECLINED' });
    return { id: swapId, status: v.accept ? ('ACCEPTED' as const) : ('DECLINED' as const) };
  });
}

export async function confirmSwap(user: Actor, swapId: string) {
  need(user, 'hr.duties.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.dutySwap.findFirst({ where: { id: swapId, schoolId: user.schoolId } });
    if (!s) throw new ServiceError('Swap not found', 404);
    // Rule 7: nobody confirms a duty swap they are part of, whatever their role.
    const parties = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: [s.fromEmployeeId, s.toEmployeeId] } }, select: { userId: true } });
    for (const p of parties) if (p.userId) guards.cannotApproveOwn(user, p.userId, 'duty swap');
    if (s.status !== 'ACCEPTED') throw new ServiceError(s.status === 'REQUESTED' ? 'The colleague has not accepted yet' : `This swap is ${s.status.toLowerCase()}`, 409);
    const a = await tx.dutyAssignment.findFirstOrThrow({ where: { id: s.assignmentId } });
    if (a.employeeId !== s.fromEmployeeId) throw new ServiceError('The duty is no longer theirs', 409);
    if (await tx.dutyAssignment.findFirst({ where: { rosterId: a.rosterId, dutyTypeId: a.dutyTypeId, date: a.date, employeeId: s.toEmployeeId }, select: { id: true } })) throw new ServiceError('The colleague already has this duty that day', 409);
    await tx.dutyAssignment.update({ where: { id: a.id }, data: { employeeId: s.toEmployeeId } });
    await tx.dutySwap.update({ where: { id: swapId }, data: { status: 'CONFIRMED', confirmedById: user.id } });
    const people = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: [s.fromEmployeeId, s.toEmployeeId] } } });
    for (const p of people) await tellEmployee(tx, user.schoolId, p, { title: 'The duty swap is confirmed', body: isoOf(a.date), link: '/hr/me/duties' });
    await audit(tx, user, 'HR_SWAP_DUTY', 'DutySwap', swapId, `Confirmed the duty swap for ${isoOf(a.date)}`, { employeeId: s.fromEmployeeId }, { employeeId: s.toEmployeeId });
    return { id: swapId, status: 'CONFIRMED' as const };
  });
}

export async function cancelSwap(user: Actor, swapId: string) {
  need(user, 'hr.self.details');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const me = await ownEmployee(tx, user);
    const s = await tx.dutySwap.findFirst({ where: { id: swapId, schoolId: user.schoolId } });
    if (!s || !me || s.fromEmployeeId !== me.id) throw new ServiceError('Swap not found', 404);
    if (!['REQUESTED', 'ACCEPTED'].includes(s.status)) throw new ServiceError('This swap is closed already', 409);
    await tx.dutySwap.update({ where: { id: swapId }, data: { status: 'CANCELLED' } });
    return { id: swapId, status: 'CANCELLED' as const };
  });
}

/** Swaps waiting for the Deputy (hr.duties.manage) or for the colleague to answer. */
export async function listSwaps(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const manage = hrHolds(user, 'hr.duties.manage');
    const me = await ownEmployee(tx, user);
    if (!manage && !me) throw new ServiceError('Forbidden', 403);
    const rows = await tx.dutySwap.findMany({ where: { schoolId: user.schoolId, status: { in: ['REQUESTED', 'ACCEPTED'] }, ...(manage ? {} : { OR: [{ fromEmployeeId: me!.id }, { toEmployeeId: me!.id }] }) }, orderBy: { createdAt: 'desc' } });
    const emps = new Map((await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.flatMap((r) => [r.fromEmployeeId, r.toEmployeeId]) } } })).map((e) => [e.id, fullName(e)]));
    const asg = new Map((await tx.dutyAssignment.findMany({ where: { id: { in: rows.map((r) => r.assignmentId) } } })).map((a) => [a.id, a]));
    return rows.map((r) => ({ id: r.id, from: emps.get(r.fromEmployeeId) ?? '?', to: emps.get(r.toEmployeeId) ?? '?', status: r.status, date: asg.get(r.assignmentId) ? isoOf(asg.get(r.assignmentId)!.date) : null, reason: r.reason, mineToAnswer: me?.id === r.toEmployeeId && r.status === 'REQUESTED' }));
  });
}
