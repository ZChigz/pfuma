// Small pieces every Finance service uses: the permission check, the amounts and dates people type, the school's funds and
// money controls, and numbers for receipts and requests.
import { z } from 'zod';
import type { AuditAction, Fund, FinSettings, Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import type { Db } from '@/lib/scoped-db';
import { holds, type Actor } from '@/lib/academics/common';
import { MAX_CENTS, parseCents, type Cur } from '@/lib/finance/money';

export { holds };
export type { Actor };
export { idSchema, isoDateSchema, reasonSchema, noteSchema } from '@/lib/students/common';
export { resolveTerm, writableTerm, assertWritable, todayInHarare, toDay, isoOf } from '@/lib/academics/common';

/** Throws 403 unless the person holds at least one of the permissions (Owner and Administrator hold them all). */
export function need(user: Actor, ...keys: PermissionKey[]): void {
  if (!keys.some((k) => holds(user, k))) throw new ServiceError('Forbidden', 403);
}

export const currencySchema = z.enum(['USD', 'ZIG'], { message: 'Choose US dollars or ZiG' });

/**
 * An amount typed by a person ("125.50" or 125.5) becomes whole cents; a client may also send `amountCents` itself.
 * Either way the server ends up with a positive whole number.
 */
export const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      return parseCents(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  })
  .refine((c) => c > 0, 'The amount must be more than zero');

export const centsSchema = z.number().int('Amounts are whole cents').positive('The amount must be more than zero').max(MAX_CENTS, 'That amount is too large');

export const textSchema = (label: string, min = 1, max = 200) =>
  z.string().trim().min(min, `Enter ${label}`).max(max, `${label} is limited to ${max} characters`);

/** A business reason that has to be written down (credit notes, voids, refunds, rejections). */
export const whySchema = (min = 10) => z.string().trim().min(min, `Give a reason (at least ${min} characters)`).max(300);

// ─── Funds and controls ──────────────────────────────────────────────────────

export const DEFAULT_FUNDS: { code: string; name: string; kind: 'TUITION' | 'SDC_LEVY' | 'BOARDING' | 'BUILDING' | 'EXAMS' | 'GENERAL' | 'OTHER' }[] = [
  { code: 'TUITION', name: 'Tuition', kind: 'TUITION' },
  { code: 'SDC', name: 'SDC levy', kind: 'SDC_LEVY' },
  { code: 'BOARDING', name: 'Boarding', kind: 'BOARDING' },
  { code: 'GENERAL', name: 'General', kind: 'GENERAL' },
  { code: 'BUILDING', name: 'Building levy', kind: 'BUILDING' },
  { code: 'EXAMS', name: 'Exams', kind: 'EXAMS' },
  { code: 'OTHER', name: 'Other', kind: 'OTHER' },
];

/** The school's list of things it charges for, with the fund each belongs to, and whether it is billed every term. */
export const DEFAULT_FEE_ITEMS: { name: string; fund: string; recurring: boolean }[] = [
  { name: 'Tuition', fund: 'TUITION', recurring: true }, { name: 'SDC levy', fund: 'SDC', recurring: true }, { name: 'Boarding fee', fund: 'BOARDING', recurring: true },
  { name: 'Building levy', fund: 'BUILDING', recurring: true }, { name: 'Sports levy', fund: 'GENERAL', recurring: true }, { name: 'Library levy', fund: 'GENERAL', recurring: true },
  { name: 'Computer / ICT levy', fund: 'GENERAL', recurring: true }, { name: 'Exam fee', fund: 'EXAMS', recurring: false }, { name: 'Uniform', fund: 'GENERAL', recurring: false },
  { name: 'Transport', fund: 'GENERAL', recurring: false }, { name: 'Trips', fund: 'GENERAL', recurring: false }, { name: 'Library fine', fund: 'GENERAL', recurring: false },
  { name: 'Other', fund: 'OTHER', recurring: false },
];

export const DEFAULT_CATEGORIES = ['Stationery', 'Teaching materials', 'Food and catering', 'Maintenance and repairs', 'Utilities', 'Transport and fuel', 'Sports', 'Staff welfare', 'Exams', 'Cleaning', 'Security', 'Bank charges', 'Salaries', 'Other'];

/** A school's funds; the standard ones are made the first time anyone looks, with the school's fee items and expense categories. */
export async function ensureFunds(tx: Db, schoolId: string): Promise<Fund[]> {
  if ((await tx.fund.count({ where: { schoolId } })) === 0) {
    await tx.fund.createMany({ data: DEFAULT_FUNDS.map((f, i) => ({ schoolId, code: f.code, name: f.name, kind: f.kind, sortOrder: i })), skipDuplicates: true });
  }
  const funds = await tx.fund.findMany({ where: { schoolId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if ((await tx.feeItem.count({ where: { schoolId } })) === 0) {
    const byCode = new Map(funds.map((f) => [f.code, f.id]));
    await tx.feeItem.createMany({
      data: DEFAULT_FEE_ITEMS.filter((i) => byCode.has(i.fund)).map((i, n) => ({ schoolId, name: i.name, fundId: byCode.get(i.fund)!, recurring: i.recurring, sortOrder: n })),
      skipDuplicates: true,
    });
  }
  if ((await tx.expenseCategory.count({ where: { schoolId } })) === 0) {
    await tx.expenseCategory.createMany({ data: DEFAULT_CATEGORIES.map((name, sortOrder) => ({ schoolId, name, sortOrder })), skipDuplicates: true });
  }
  return funds;
}

export async function loadFinSettings(tx: Db, schoolId: string): Promise<FinSettings> {
  const existing = await tx.finSettings.findUnique({ where: { schoolId } });
  if (existing) return existing;
  return tx.finSettings.upsert({ where: { schoolId }, update: {}, create: { schoolId } });
}

/** A fund of this school that can take new money (active). */
export async function activeFund(tx: Db, schoolId: string, fundId: string): Promise<Fund> {
  await ensureFunds(tx, schoolId);
  const fund = await tx.fund.findFirst({ where: { id: fundId, schoolId } });
  if (!fund) throw new ServiceError('Fund not found', 404);
  if (!fund.active) throw new ServiceError(`The ${fund.name} fund is switched off`, 409);
  return fund;
}

/** The currencies the school has switched on in Settings. */
export async function enabledCurrencies(tx: Db, schoolId: string): Promise<Cur[]> {
  const s = await tx.school.findUnique({ where: { id: schoolId }, select: { currencyUsdEnabled: true, currencyZigEnabled: true } });
  const out: Cur[] = [];
  if (!s || s.currencyUsdEnabled) out.push('USD');
  if (!s || s.currencyZigEnabled) out.push('ZIG');
  return out;
}

export async function assertCurrencyOn(tx: Db, schoolId: string, currency: Cur): Promise<void> {
  if (!(await enabledCurrencies(tx, schoolId)).includes(currency)) {
    throw new ServiceError(`${currency === 'USD' ? 'US dollars are' : 'ZiG is'} switched off for this school (Settings, Finance)`, 409);
  }
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

/**
 * The next official receipt number (or acknowledgement number) of a book: PREFIX-YEAR-000124. The counter row is locked while the number is
 * taken, so two people at once never get the same one and none is skipped. A voided payment keeps its number.
 */
export async function nextSerial(tx: Db, schoolId: string, year: number, prefix: string): Promise<string> {
  await tx.receiptSequence.createMany({ data: [{ schoolId, year, prefix, nextNumber: 1 }], skipDuplicates: true });
  const rows = await tx.$queryRaw<{ n: number }[]>`UPDATE "ReceiptSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "schoolId" = ${schoolId} AND "year" = ${year} AND "prefix" = ${prefix} RETURNING "nextNumber" - 1 AS "n"`;
  return `${prefix}-${year}-${String(rows[0]!.n).padStart(6, '0')}`;
}

/** An official receipt number, in the book of the fund's receipt prefix (RCP when it has none). */
export const nextReceiptNumber = (tx: Db, schoolId: string, year: number, prefix = 'RCP') => nextSerial(tx, schoolId, year, prefix.trim().toUpperCase() || 'RCP');

/** PR-2026-0087: this school's purchase requests, counted per year. */
export async function nextRequestNumber(tx: Db, schoolId: string, year: number): Promise<string> {
  const prefix = `PR-${year}-`;
  const last = await tx.finExpenseRequest.findFirst({ where: { schoolId, requestNumber: { startsWith: prefix } }, orderBy: { requestNumber: 'desc' }, select: { requestNumber: true } });
  const n = last ? Number(last.requestNumber.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

// ─── People ──────────────────────────────────────────────────────────────────

/** id → name, for showing who recorded, verified or approved something. */
export async function nameMap(tx: Db, schoolId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map();
  const rows = await tx.user.findMany({ where: { schoolId, id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

export const nameOf = (m: Map<string, string>, id: string | null | undefined): string | null => (id ? (m.get(id) ?? 'Unknown') : null);

/** Today's date in Harare as a Date at midnight UTC, for @db.Date columns. */
export const dayOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** A Date from a @db.Date column as YYYY-MM-DD. */
export const ymd = (d: Date): string => d.toISOString().slice(0, 10);

// ─── Audit and notices ───────────────────────────────────────────────────────

/**
 * The business entry for a money action, written inside the action's own transaction with what the record looked like
 * before and after. (The database trigger adds a row-level entry beside it.) A failed write rolls the whole action back.
 */
export async function audit(
  tx: Db,
  user: Pick<Actor, 'id' | 'schoolId'>,
  action: AuditAction,
  entityType: string,
  entityId: string,
  detail: string,
  before?: Prisma.InputJsonValue,
  after?: Prisma.InputJsonValue,
): Promise<void> {
  await logAudit({ schoolId: user.schoolId, actorId: user.id, action, entityType, entityId, detail, before, after }, tx);
}

/** Tells the people who hold `permission` (apart from the actor) that something waits for them. */
export async function tellApprovers(tx: Db, user: Pick<Actor, 'id' | 'schoolId'>, permission: PermissionKey, n: { title: string; body?: string; link?: string }): Promise<void> {
  const ids = await approverIds(tx, user.schoolId, permission, user.id);
  await notifyUsers(tx, user.schoolId, ids, { type: 'FINANCE', ...n });
}

/** Every permission that lets a person look at some part of Finance. */
export const ANY_FINANCE: PermissionKey[] = [
  'finance.fees.view', 'finance.accounts.view', 'finance.payments.view', 'finance.expenses.view', 'finance.requests.view', 'finance.requests.create',
  'finance.reports.view', 'finance.payments.record', 'finance.payments.verify', 'finance.adjustments.approve', 'finance.refunds.approve', 'finance.requests.approve',
];
