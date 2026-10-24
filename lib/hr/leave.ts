// Leave. Staff request it from their phone, the Head approves it (for teaching staff the Head can delegate to the Deputy), and the
// balance, the staff register, the school calendar ("away", never the reason) and the cover list all follow by themselves.
// Only school days are counted (the Calendar decides), nobody approves their own leave, and a rejection needs a reason.
import { z } from 'zod';
import type { Employee, LeaveRequest, LeaveType, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import {
  audit, daysBetween, fullName, hrHolds, idSchema, isFull, isoDateSchema, isoOf, loadHrSettings, need, optText, ownEmployee, reasonSchema, requireOwnEmployee, tellEmployee,
  toDay, todayInHarare, type Actor,
} from '@/lib/hr/common';
import { ensureHrDefaults } from '@/lib/hr/defaults';
import { workCalendar } from '@/lib/hr/calendar';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';

export interface Balance { typeId: string; code: string; name: string; year: number; accrued: number; carriedOver: number; adjusted: number; taken: number; pending: number; remaining: number; limited: boolean }

const half = (n: number) => Math.round(n * 2) / 2;

/** Days earned so far in `year` as of `asOf`: monthly accrual from the later of 1 January and the start date, else the full year. */
export function accruedDays(type: Pick<LeaveType, 'daysPerYear' | 'accruesMonthly'>, startDate: string, year: number, asOf: string): number {
  if (!type.accruesMonthly) return type.daysPerYear;
  const yearStart = `${year}-01-01`;
  const from = startDate > yearStart ? startDate : yearStart;
  const to = asOf < `${year}-12-31` ? asOf : `${year}-12-31`;
  if (to < from) return 0;
  const m0 = Number(from.slice(5, 7)), m1 = Number(to.slice(5, 7));
  // A month counts once it has been worked in (monthly accrual): joining in March earns from March.
  return half((type.daysPerYear * (m1 - m0 + 1)) / 12);
}

export async function balanceOf(tx: Db, schoolId: string, e: Pick<Employee, 'id' | 'startDate'>, type: LeaveType, year: number, asOf: string): Promise<Balance> {
  const [bal, reqs] = await Promise.all([
    tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: e.id, leaveTypeId: type.id, year } } }),
    tx.leaveRequest.findMany({ where: { schoolId, employeeId: e.id, leaveTypeId: type.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { gte: toDay(`${year}-01-01`), lte: toDay(`${year}-12-31`) } }, select: { status: true, days: true } }),
  ]);
  const accrued = accruedDays(type, isoOf(e.startDate), year, asOf);
  const taken = reqs.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.days, 0);
  const pending = reqs.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.days, 0);
  const carriedOver = bal?.carriedOver ?? 0, adjusted = bal?.adjusted ?? 0;
  return { typeId: type.id, code: type.code, name: type.name, year, accrued, carriedOver, adjusted, taken, pending, remaining: accrued + carriedOver + adjusted - taken - pending, limited: type.deductsBalance && type.daysPerYear > 0 };
}

/** Balances of one person for every leave type. Their own, or anyone's for HR. */
export async function getBalances(user: Actor, employeeId?: string, year?: number) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const e = employeeId ? await tx.employee.findFirst({ where: { id: employeeId, schoolId: user.schoolId } }) : await ownEmployee(tx, user);
    if (!e) throw new ServiceError(employeeId ? 'Employee not found' : 'You have no staff record yet. Ask HR to link your login to it.', 404);
    if (e.userId !== user.id) need(user, 'hr.leave.view_all');
    else need(user, 'hr.self.leave');
    const y = year ?? Number(todayInHarare().slice(0, 4));
    const types = await tx.leaveType.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { sortOrder: 'asc' } });
    return Promise.all(types.map((t) => balanceOf(tx, user.schoolId, e, t, y, todayInHarare())));
  });
}

export async function listLeaveTypes(user: Actor) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    return tx.leaveType.findMany({ where: { schoolId: user.schoolId }, orderBy: { sortOrder: 'asc' } });
  });
}

export const LeaveTypeSchema = z.object({
  id: idSchema.optional(), code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9_]+$/, 'Use capital letters, digits and underscores'), name: z.string().trim().min(2).max(60),
  daysPerYear: z.number().min(0).max(366), accruesMonthly: z.boolean().default(false), carryOverMax: z.number().min(0).max(366).default(0),
  fullPayDays: z.number().min(0).max(366).nullable().optional(), halfPayDays: z.number().min(0).max(366).nullable().optional(), certificateAfterDays: z.number().int().min(0).max(60).nullable().optional(),
  requiresAttachment: z.boolean().default(false), deductsBalance: z.boolean().default(true), unpaid: z.boolean().default(false), calendarDays: z.boolean().default(false), active: z.boolean().default(true),
  reason: reasonSchema(3),
});

/** HR edits the rules of a leave type. Changes are audited with before and after. */
export async function saveLeaveType(user: Actor, raw: unknown) {
  need(user, 'hr.leave.adjust', 'hr.employees.manage');
  const { reason, id, ...v } = LeaveTypeSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const data = { ...v, fullPayDays: v.fullPayDays ?? null, halfPayDays: v.halfPayDays ?? null, certificateAfterDays: v.certificateAfterDays ?? null };
    let row;
    if (id) {
      const before = await tx.leaveType.findFirst({ where: { id, schoolId: user.schoolId } });
      if (!before) throw new ServiceError('Leave type not found', 404);
      row = await tx.leaveType.update({ where: { id }, data });
      await audit(tx, user, 'HR_SAVE_LEAVE_TYPE', 'LeaveType', id, `Changed leave type ${v.name} (${reason})`, { daysPerYear: before.daysPerYear, carryOverMax: before.carryOverMax, unpaid: before.unpaid }, { daysPerYear: v.daysPerYear, carryOverMax: v.carryOverMax, unpaid: v.unpaid });
    } else {
      if (await tx.leaveType.findFirst({ where: { schoolId: user.schoolId, code: v.code }, select: { id: true } })) throw new ServiceError('There is already a leave type with this code', 409);
      row = await tx.leaveType.create({ data: { schoolId: user.schoolId, sortOrder: 99, ...data } });
      await audit(tx, user, 'HR_SAVE_LEAVE_TYPE', 'LeaveType', row.id, `Added leave type ${v.name} (${reason})`, undefined, { daysPerYear: v.daysPerYear });
    }
    return { id: row.id };
  });
}

// ─── Requests ────────────────────────────────────────────────────────────────

export const LeaveRequestSchema = z.object({
  leaveTypeId: idSchema, startDate: isoDateSchema, endDate: isoDateSchema, startHalfDay: z.boolean().default(false), endHalfDay: z.boolean().default(false),
  reason: optText(500), attachmentKey: optText(300), handoverNotes: optText(1000), coverEmployeeId: idSchema.optional(),
}).refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'The end date is before the start date' });

/** School days (or calendar days for maternity) the request uses, half days taken off at the ends. */
export async function countLeaveDays(tx: Db, schoolId: string, type: Pick<LeaveType, 'calendarDays'>, v: { startDate: string; endDate: string; startHalfDay?: boolean; endHalfDay?: boolean }): Promise<number> {
  if (type.calendarDays) return daysBetween(v.startDate, v.endDate);
  const cal = await workCalendar(tx, schoolId, v.startDate, v.endDate);
  const days = cal.days(v.startDate, v.endDate);
  let n = days.length;
  if (v.startHalfDay && days.includes(v.startDate)) n -= 0.5;
  if (v.endHalfDay && days.includes(v.endDate) && !(v.startDate === v.endDate && v.startHalfDay)) n -= 0.5;
  return n;
}

async function departmentAway(tx: Db, schoolId: string, e: Employee, from: string, to: string) {
  if (!e.departmentId) return [];
  const mates = await tx.employee.findMany({ where: { schoolId, departmentId: e.departmentId, id: { not: e.id } }, select: { id: true, title: true, firstName: true, surname: true } });
  if (!mates.length) return [];
  const away = await tx.leaveRequest.findMany({ where: { schoolId, employeeId: { in: mates.map((m) => m.id) }, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDay(to) }, endDate: { gte: toDay(from) } } });
  const nm = new Map(mates.map((m) => [m.id, fullName(m, true)]));
  return away.map((a) => ({ employee: nm.get(a.employeeId) ?? '?', from: isoOf(a.startDate), to: isoOf(a.endDate), status: a.status }));
}

async function evaluate(tx: Db, user: Actor, e: Employee, v: z.infer<typeof LeaveRequestSchema>) {
  const type = await tx.leaveType.findFirst({ where: { id: v.leaveTypeId, schoolId: user.schoolId, active: true } });
  if (!type) throw new ServiceError('Leave type not found', 404);
  if (['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'].includes(e.status)) throw new ServiceError('This person has left', 409);
  const days = await countLeaveDays(tx, user.schoolId, type, v);
  if (days <= 0) throw new ServiceError('There are no school days between those dates (weekends, public holidays and school holidays are not counted).', 422);
  const overlap = await tx.leaveRequest.findFirst({ where: { schoolId: user.schoolId, employeeId: e.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: toDay(v.endDate) }, endDate: { gte: toDay(v.startDate) } } });
  if (overlap) throw new ServiceError(`You already have leave from ${isoOf(overlap.startDate)} to ${isoOf(overlap.endDate)} that covers some of these dates.`, 409);
  const year = Number(v.startDate.slice(0, 4));
  const before = await balanceOf(tx, user.schoolId, e, type, year, v.startDate > todayInHarare() ? v.startDate : todayInHarare());
  const after = before.limited ? before.remaining - days : before.remaining;
  if (before.limited && after < 0) throw new ServiceError(`You have ${before.remaining} day${before.remaining === 1 ? '' : 's'} of ${type.name.toLowerCase()} leave left and this request needs ${days}.`, 409);
  if (type.certificateAfterDays != null && days > type.certificateAfterDays && !v.attachmentKey) throw new ServiceError(`A medical certificate is needed for more than ${type.certificateAfterDays} days. Attach it.`, 422);
  if (type.requiresAttachment && !v.attachmentKey) throw new ServiceError(`${type.name} leave needs a document attached (certificate or proof).`, 422);
  if (v.coverEmployeeId) {
    if (v.coverEmployeeId === e.id) throw new ServiceError('Choose someone else to cover your duties', 422);
    if (!(await tx.employee.findFirst({ where: { id: v.coverEmployeeId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('The person to cover was not found', 404);
  }
  return { type, days, before, after };
}

/** What a request would use and leave behind, without making it: the form shows the balance before and after. */
export async function previewLeave(user: Actor, raw: unknown) {
  need(user, 'hr.leave.request');
  const v = LeaveRequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const e = await requireOwnEmployee(tx, user);
    const r = await evaluate(tx, user, e, v);
    return { days: r.days, balanceBefore: r.before.remaining, balanceAfter: r.after, limited: r.before.limited };
  });
}

export async function requestLeave(user: Actor, raw: unknown) {
  need(user, 'hr.leave.request');
  const v = LeaveRequestSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureHrDefaults(tx, user.schoolId);
    const e = await requireOwnEmployee(tx, user);
    const r = await evaluate(tx, user, e, v);
    const row = await tx.leaveRequest.create({
      data: {
        schoolId: user.schoolId, employeeId: e.id, leaveTypeId: r.type.id, startDate: toDay(v.startDate), endDate: toDay(v.endDate), startHalfDay: v.startHalfDay, endHalfDay: v.endHalfDay, days: r.days,
        reason: v.reason ?? null, attachmentKey: v.attachmentKey ?? null, handoverNotes: v.handoverNotes ?? null, coverEmployeeId: v.coverEmployeeId ?? null, requestedById: user.id,
        recordOnly: e.employer === 'GOVERNMENT',
      },
    });
    await audit(tx, user, 'HR_REQUEST_LEAVE', 'LeaveRequest', row.id, `${fullName(e)} asked for ${r.days} day(s) of ${r.type.name.toLowerCase()} leave, ${v.startDate} to ${v.endDate}`, undefined, { type: r.type.code, days: r.days, from: v.startDate, to: v.endDate });
    const settings = await loadHrSettings(tx, user.schoolId);
    const ids = new Set(await approverIds(tx, user.schoolId, 'hr.leave.approve', user.id));
    // The Head approves; the Deputy only when the Head has delegated teaching staff to them.
    const heads = await tx.user.findMany({ where: { schoolId: user.schoolId, id: { in: Array.from(ids) }, userRoles: { some: { role: { key: { in: ['HEAD', 'OWNER', 'ADMINISTRATOR'] } } } } }, select: { id: true } });
    const notify = new Set(heads.map((h) => h.id));
    if (settings.leaveDelegateUserId && e.category === 'TEACHING' && settings.leaveDelegateUserId !== user.id) notify.add(settings.leaveDelegateUserId);
    await notifyUsers(tx, user.schoolId, Array.from(notify), { type: 'HR', title: `${fullName(e)} asked for leave`, body: `${r.type.name}, ${v.startDate} to ${v.endDate}`, link: '/hr/leave', dedupeKey: `leave-req:${row.id}` });
    return { id: row.id, days: r.days, balanceBefore: r.before.remaining, balanceAfter: r.after };
  });
}

export const DecideLeaveSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() });

/** May this approver decide on this employee's leave? The Head (and Owner/Administrator); the Deputy only for teaching staff the Head delegated. */
async function mayDecideFor(tx: Db, user: Actor, e: Employee): Promise<boolean> {
  if (isFull(user) || (user.roles ?? []).includes('HEAD')) return true;
  const s = await loadHrSettings(tx, user.schoolId);
  return s.leaveDelegateUserId === user.id && e.category === 'TEACHING';
}

export async function decideLeave(user: Actor, id: string, raw: unknown) {
  need(user, 'hr.leave.approve');
  const v = DecideLeaveSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.leaveRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Leave request not found', 404);
    if (r.status !== 'PENDING') throw new ServiceError(`This request is ${r.status.toLowerCase()} already.`, 409);
    const e = await tx.employee.findFirstOrThrow({ where: { id: r.employeeId, schoolId: user.schoolId } });
    if (e.userId === user.id || r.requestedById === user.id) throw new ServiceError('Nobody approves their own leave. Ask the Head or another approver.', 403);
    if (!(await mayDecideFor(tx, user, e))) throw new ServiceError('Only the Head can decide on this leave (the Deputy only for teaching staff the Head has delegated).', 403);
    const type = await tx.leaveType.findFirstOrThrow({ where: { id: r.leaveTypeId } });
    if (v.decision === 'REJECT') {
      if (!v.reason || v.reason.length < 3) throw new ServiceError('Give a reason for rejecting', 422);
      await tx.leaveRequest.update({ where: { id }, data: { status: 'REJECTED', approvedById: user.id, decidedAt: new Date(), decisionReason: v.reason } });
      await audit(tx, user, 'HR_DECIDE_LEAVE', 'LeaveRequest', id, `Rejected ${fullName(e)}'s ${type.name.toLowerCase()} leave: ${v.reason}`, { status: 'PENDING' }, { status: 'REJECTED' });
      await tellEmployee(tx, user.schoolId, e, { title: 'Your leave request was not approved', body: v.reason, link: '/hr/me/leave' });
      return { id, status: 'REJECTED' as const };
    }
    // The balance may have changed since the request was made.
    const year = Number(isoOf(r.startDate).slice(0, 4));
    const bal = await balanceOf(tx, user.schoolId, e, type, year, isoOf(r.startDate));
    if (bal.limited && bal.remaining < 0) throw new ServiceError(`${fullName(e)} no longer has enough ${type.name.toLowerCase()} leave.`, 409);
    await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, decidedAt: new Date(), decisionReason: v.reason || null } });
    // The school calendar shows that they are away, never why.
    await tx.calendarEvent.upsert({
      where: { schoolId_autoKey: { schoolId: user.schoolId, autoKey: `LEAVE:${id}` } }, update: {},
      create: { schoolId: user.schoolId, title: `${fullName(e, true)} away`, kind: 'OTHER', startDate: r.startDate, endDate: r.endDate, allDay: true, audience: 'ALL_STAFF', autoKey: `LEAVE:${id}`, createdById: user.id },
    });
    await audit(tx, user, 'HR_DECIDE_LEAVE', 'LeaveRequest', id, `Approved ${fullName(e)}'s ${type.name.toLowerCase()} leave, ${isoOf(r.startDate)} to ${isoOf(r.endDate)}`, { status: 'PENDING' }, { status: 'APPROVED' });
    await tellEmployee(tx, user.schoolId, e, { title: 'Your leave was approved', body: `${isoOf(r.startDate)} to ${isoOf(r.endDate)}`, link: '/hr/me/leave' });
    if (r.coverEmployeeId) {
      const c = await tx.employee.findFirst({ where: { id: r.coverEmployeeId, schoolId: user.schoolId } });
      if (c) await tellEmployee(tx, user.schoolId, c, { title: `You cover ${fullName(e)}'s duties`, body: `${isoOf(r.startDate)} to ${isoOf(r.endDate)}`, link: '/hr/me/duties' });
    }
    return { id, status: 'APPROVED' as const };
  });
}

export const CancelLeaveSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** A person cancels their own pending request. An approver can cancel an approved one (the calendar entry goes, the days come back). */
export async function cancelLeave(user: Actor, id: string, raw: unknown = {}) {
  const v = CancelLeaveSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const r = await tx.leaveRequest.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!r) throw new ServiceError('Leave request not found', 404);
    const e = await tx.employee.findFirstOrThrow({ where: { id: r.employeeId, schoolId: user.schoolId } });
    const own = e.userId === user.id;
    if (own) {
      need(user, 'hr.self.leave');
      if (r.status !== 'PENDING') throw new ServiceError('You can cancel a request only while it is pending. Ask the Head to cancel approved leave.', 409);
    } else {
      need(user, 'hr.leave.approve');
      if (!['PENDING', 'APPROVED'].includes(r.status)) throw new ServiceError('This request is closed already', 409);
      if (!v.reason || v.reason.length < 3) throw new ServiceError('Give a reason for cancelling', 422);
    }
    await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', decisionReason: v.reason || r.decisionReason } });
    await tx.calendarEvent.deleteMany({ where: { schoolId: user.schoolId, autoKey: `LEAVE:${id}` } });
    await audit(tx, user, 'HR_CANCEL_LEAVE', 'LeaveRequest', id, `Cancelled ${fullName(e)}'s leave request${v.reason ? `: ${v.reason}` : ''}`, { status: r.status }, { status: 'CANCELLED' });
    if (!own) await tellEmployee(tx, user.schoolId, e, { title: 'Your leave was cancelled', body: v.reason, link: '/hr/me/leave' });
    return { id, status: 'CANCELLED' as const };
  });
}

export const AdjustSchema = z.object({ employeeId: idSchema, leaveTypeId: idSchema, year: z.number().int().min(2000).max(2100), days: z.number().min(-366).max(366).refine((n) => n !== 0, 'Enter the number of days to add or take off'), reason: reasonSchema(5) });

/** HR changes a balance by hand (opening balances when the school starts using Pfuma). The reason is kept with the change. */
export async function adjustBalance(user: Actor, raw: unknown) {
  need(user, 'hr.leave.adjust');
  const v = AdjustSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.employee.findFirst({ where: { id: v.employeeId, schoolId: user.schoolId } });
    if (!e) throw new ServiceError('Employee not found', 404);
    const type = await tx.leaveType.findFirst({ where: { id: v.leaveTypeId, schoolId: user.schoolId } });
    if (!type) throw new ServiceError('Leave type not found', 404);
    await tx.leaveAdjustment.create({ data: { schoolId: user.schoolId, employeeId: e.id, leaveTypeId: type.id, year: v.year, days: v.days, reason: v.reason, adjustedById: user.id } });
    const existing = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: e.id, leaveTypeId: type.id, year: v.year } } });
    const adjusted = (existing?.adjusted ?? 0) + v.days;
    if (existing) await tx.leaveBalance.update({ where: { id: existing.id }, data: { adjusted } });
    else await tx.leaveBalance.create({ data: { schoolId: user.schoolId, employeeId: e.id, leaveTypeId: type.id, year: v.year, adjusted } });
    await audit(tx, user, 'HR_ADJUST_LEAVE', 'LeaveBalance', e.id, `${v.days > 0 ? '+' : ''}${v.days} day(s) of ${type.name.toLowerCase()} leave for ${fullName(e)} in ${v.year}: ${v.reason}`, { adjusted: existing?.adjusted ?? 0 }, { adjusted });
    return { adjusted };
  });
}

// ─── Lists ───────────────────────────────────────────────────────────────────

export async function listLeaveRequests(user: Actor, raw: unknown = {}) {
  const q = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), mine: z.coerce.boolean().optional() }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const all = hrHolds(user, 'hr.leave.view_all') || hrHolds(user, 'hr.leave.approve');
    const me = await ownEmployee(tx, user);
    if (!all && !me) throw new ServiceError('Forbidden', 403);
    if (!all) need(user, 'hr.self.leave');
    const where: Prisma.LeaveRequestWhereInput = { schoolId: user.schoolId, ...(q.status ? { status: q.status } : {}), ...(!all || q.mine ? { employeeId: me?.id ?? 'none' } : {}) };
    const rows = await tx.leaveRequest.findMany({ where, orderBy: { startDate: 'desc' }, take: 300 });
    const emps = await tx.employee.findMany({ where: { schoolId: user.schoolId, id: { in: rows.map((r) => r.employeeId) } } });
    const types = await tx.leaveType.findMany({ where: { schoolId: user.schoolId } });
    const eOf = new Map(emps.map((e) => [e.id, e])), tOf = new Map(types.map((t) => [t.id, t]));
    return Promise.all(rows.map(async (r: LeaveRequest) => {
      const e = eOf.get(r.employeeId);
      const mine = e?.userId === user.id;
      return {
        id: r.id, employeeId: r.employeeId, employee: e ? fullName(e, true) : '?', department: e?.departmentId ?? null, type: tOf.get(r.leaveTypeId)?.name ?? '?', from: isoOf(r.startDate), to: isoOf(r.endDate),
        days: r.days, status: r.status, reason: r.reason, handoverNotes: r.handoverNotes, hasAttachment: !!r.attachmentKey, recordOnly: r.recordOnly, decisionReason: r.decisionReason, mine,
        // Approvers see who else in the department is away on those dates.
        othersAway: r.status === 'PENDING' && all && e ? await departmentAway(tx, user.schoolId, e, isoOf(r.startDate), isoOf(r.endDate)) : [],
      };
    }));
  });
}

/** Who is on approved leave on a day (used by the staff register and the cover list). */
export async function onLeaveOn(tx: Db, schoolId: string, date: string): Promise<Map<string, { typeCode: string; official: boolean }>> {
  const rows = await tx.leaveRequest.findMany({ where: { schoolId, status: 'APPROVED', startDate: { lte: toDay(date) }, endDate: { gte: toDay(date) } } });
  const types = new Map((await tx.leaveType.findMany({ where: { schoolId } })).map((t) => [t.id, t]));
  return new Map(rows.map((r) => [r.employeeId, { typeCode: types.get(r.leaveTypeId)?.code ?? '', official: types.get(r.leaveTypeId)?.code === 'OFFICIAL' }]));
}


/** Colleagues' names, to choose who covers your duties or takes a duty swap. Names only. */
export async function listColleagues(user: Actor) {
  need(user, 'hr.leave.request', 'hr.self.details');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.employee.findMany({ where: { schoolId: user.schoolId, status: { notIn: ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] }, NOT: { userId: user.id } }, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }], select: { id: true, title: true, firstName: true, surname: true, jobTitle: true } });
    return rows.map((e) => ({ id: e.id, name: fullName(e, true), jobTitle: e.jobTitle }));
  });
}
