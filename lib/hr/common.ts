// Small pieces every HR service uses: the permission check (with the rule for sensitive data), the numbers people type, counters, the
// school's HR settings and starting lists, the log of who looked at someone else's pay, and the audit entry.
import { z } from 'zod';
import type { AuditAction, Employee, HrSettings, Prisma, SensitiveKind } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import { holds, type Actor } from '@/lib/academics/common';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';

export { holds };
export type { Actor };
export { idSchema, isoDateSchema, reasonSchema, noteSchema } from '@/lib/students/common';
export { todayInHarare, toDay, isoOf } from '@/lib/academics/common';
export { MAX_CENTS } from '@/lib/finance/money';

export const textSchema = (label: string, min = 1, max = 200) =>
  z.string().trim().min(min, `Enter ${label}`).max(max, `${label} is limited to ${max} characters`);
export const optText = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || undefined);
export const timeSchema = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM');
export const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month as YYYY-MM');
export const currencySchema = z.enum(['USD', 'ZIG'], { message: 'Choose US dollars or ZiG' });
export const centsSchema = z.number().int('Amounts are whole cents').min(0, 'The amount cannot be negative').max(2_000_000_000, 'That amount is too large');

// ─── Who may do what ─────────────────────────────────────────────────────────

/**
 * Personal and pay data (ID numbers, medical notes, salary, bank details, payroll, disciplinary records) is for HR, the Owner and the
 * employee only. "*" alone never opens these, not even for the Owner: the key must be granted to a role the person holds (the HR Officer
 * holds the managing keys; the Owner holds hr.pay.view, hr.payroll.approve and the view keys).
 */
export const RESTRICTED_KEYS: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  'hr.employees.view', 'hr.employees.manage', 'hr.pay.view', 'hr.pay.manage', 'hr.payroll.prepare', 'hr.payroll.approve', 'hr.payroll.view',
  'hr.payroll.settings', 'hr.discipline.view', 'hr.discipline.manage', 'hr.documents.manage',
]);

export function hrHolds(user: Actor, key: PermissionKey): boolean {
  if (!RESTRICTED_KEYS.has(key)) return holds(user, key);
  return (user.grants ?? []).includes(key);
}

/** Throws 403 unless the person holds at least one of the permissions. */
export function need(user: Actor, ...keys: PermissionKey[]): void {
  if (!keys.some((k) => hrHolds(user, k))) throw new ServiceError('Forbidden', 403);
}

/** Salary, bank details, ID numbers and medical notes of someone else. */
export const canSeePay = (user: Actor): boolean => hrHolds(user, 'hr.pay.view');

// ─── Sequences, settings, defaults ───────────────────────────────────────────

/** The next number of a counter: 1, 2, 3 ... never repeated, none skipped. The row is locked while it is taken. */
export async function nextNumber(tx: Db, schoolId: string, key: string): Promise<number> {
  await tx.hrSequence.createMany({ data: [{ schoolId, key, nextNumber: 1 }], skipDuplicates: true });
  const rows = await tx.$queryRaw<{ n: number }[]>`UPDATE "HrSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "schoolId" = ${schoolId} AND "key" = ${key} RETURNING "nextNumber" - 1 AS "n"`;
  return rows[0]!.n;
}

export async function nextEmployeeNo(tx: Db, schoolId: string): Promise<string> {
  return `EMP-${String(await nextNumber(tx, schoolId, 'EMP')).padStart(4, '0')}`;
}

export async function loadHrSettings(tx: Db, schoolId: string): Promise<HrSettings> {
  const existing = await tx.hrSettings.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return tx.hrSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
}

// ─── People ──────────────────────────────────────────────────────────────────

export async function employeeById(tx: Db, schoolId: string, id: string): Promise<Employee> {
  const e = await tx.employee.findFirst({ where: { id, schoolId } });
  if (!e) throw new ServiceError('Employee not found', 404);
  return e;
}

/** The employee record of the signed-in person (null for someone with a login but no staff record, such as Pfuma support). */
export async function ownEmployee(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>): Promise<Employee | null> {
  return tx.employee.findFirst({ where: { schoolId: user.schoolId, userId: user.id } });
}

export async function requireOwnEmployee(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>): Promise<Employee> {
  const e = await ownEmployee(tx, user);
  if (!e) throw new ServiceError('You have no staff record yet. Ask HR to link your login to it.', 404);
  return e;
}

export const fullName = (e: Pick<Employee, 'title' | 'firstName' | 'surname'>, withTitle = false) =>
  `${withTitle && e.title ? `${e.title} ` : ''}${e.firstName} ${e.surname}`.trim();

export const LEAVER_STATUSES = ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] as const;

// ─── Logging ─────────────────────────────────────────────────────────────────

/** The business audit entry, written inside the action's own transaction. A failed write rolls the whole action back. */
export async function audit(
  tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, action: AuditAction, entityType: string, entityId: string, detail: string,
  before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue,
): Promise<void> {
  await logAudit({ schoolId: user.schoolId, actorId: user.id, action, entityType, entityId, detail, before, after }, tx);
}

/**
 * Records that someone looked at another person's salary, payslip, bank details, ID number, medical notes or disciplinary record.
 * Looking at your own is not logged. Call it inside the same transaction as the read.
 */
export async function logSensitiveView(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, employee: Pick<Employee, 'id' | 'userId'>, kind: SensitiveKind, context?: string): Promise<boolean> {
  if (employee.userId && employee.userId === user.id) return false;
  await tx.hrSensitiveView.create({ data: { schoolId: user.schoolId, employeeId: employee.id, viewerId: user.id, kind, context: context ?? null } });
  await audit(tx, user, 'HR_VIEW_SENSITIVE', 'Employee', employee.id, `Viewed ${kind.toLowerCase().replace('_', ' ')} of an employee${context ? ` (${context})` : ''}`);
  return true;
}

/** Tells the people who hold `permission` (apart from the actor) that something waits for them. */
export async function tellHolders(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, permission: PermissionKey, n: { title: string; body?: string; link?: string; dedupeKey?: string }): Promise<void> {
  const ids = await approverIds(tx, user.schoolId, permission, user.id);
  await notifyUsers(tx, user.schoolId, ids, { type: 'HR', ...n });
}

export async function tellEmployee(tx: Db, schoolId: string, employee: Pick<Employee, 'userId'>, n: { title: string; body?: string; link?: string; dedupeKey?: string }): Promise<void> {
  if (employee.userId) await notifyUsers(tx, schoolId, [employee.userId], { type: 'HR', ...n });
}

/** Days between two ISO dates, inclusive. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

/** The first and last day (ISO) of a month "YYYY-MM". */
export function monthRange(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}`, days };
}

/** Payroll runs of a school with these statuses and a month inside [from, to] (YYYY-MM). Lines are matched by run id, not by relation. */
export async function runsIn(tx: Db, schoolId: string, statuses: ('DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID' | 'RETURNED')[], from?: string, to?: string) {
  return tx.hrPayrollRun.findMany({ where: { schoolId, status: { in: statuses }, ...(from || to ? { month: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, select: { id: true, month: true } });
}
