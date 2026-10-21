// Expenses: money that left the school. An expense exists only when an approved request was paid (lib/finance/requests.ts) or the
// bursar records a direct expense here, within the limit the school has set. Never edited; a mistake is voided by someone else.
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import {
  activeFund, amountSchema, assertCurrencyOn, audit, currencySchema, dayOf, idSchema, isoDateSchema, loadFinSettings, nameMap, nameOf, need, textSchema, todayInHarare, whySchema, ymd, type Actor,
} from '@/lib/finance/common';
import type { Cur } from '@/lib/finance/money';
import { METHODS, type Method } from '@/lib/finance/methods';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';


export const DirectExpenseSchema = z.object({
  fundId: idSchema,
  category: textSchema('a category', 1, 60).optional(),
  categoryId: idSchema.optional(),
  supplierId: idSchema.optional(),
  receiptKey: z.string().trim().max(200).optional(),
  description: textSchema('what was bought', 3, 200),
  payee: z.string().trim().max(80).optional().transform((v) => v || undefined),
  currency: currencySchema,
  amount: amountSchema,
  paidOn: isoDateSchema.optional(),
  method: z.enum(METHODS),
  reference: z.string().trim().max(80).optional().transform((v) => v || undefined),
});

export async function recordDirectExpense(user: Actor, raw: unknown) {
  need(user, 'finance.expenses.record', 'finance.expenses.manage');
  const input = DirectExpenseSchema.parse(raw);
  const paidOn = input.paidOn ?? todayInHarare();
  if (paidOn > todayInHarare()) throw new ServiceError('The date paid cannot be in the future', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const fund = await activeFund(tx, user.schoolId, input.fundId);
    await assertCurrencyOn(tx, user.schoolId, input.currency);
    const s = await loadFinSettings(tx, user.schoolId);
    const cat = input.categoryId ? await tx.expenseCategory.findFirst({ where: { id: input.categoryId, schoolId: user.schoolId } }) : null;
    if (input.categoryId && !cat) throw new ServiceError('Expense category not found', 404);
    const category = cat?.name ?? input.category;
    if (!category) throw new ServiceError('Choose the expense category', 422);
    if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId, schoolId: user.schoolId } }))) throw new ServiceError('Supplier not found', 404);
    if (input.receiptKey && !proofKeyBelongsTo(input.receiptKey, user.schoolId)) throw new ServiceError('That receipt does not belong to this school', 422);
    const receiptAbove = input.currency === 'USD' ? s.receiptRequiredAboveUsdCents : s.receiptRequiredAboveZigCents;
    if (receiptAbove !== null && input.amount > receiptAbove && !input.receiptKey) throw new ServiceError('Upload the receipt or invoice for an expense of this size', 422);
    const limit = input.currency === 'USD' ? s.directLimitUsdCents : s.directLimitZigCents;
    if (limit !== null && input.amount > limit) {
      throw new ServiceError(`A direct expense can be at most ${(limit / 100).toFixed(2)} ${input.currency === 'USD' ? 'US dollars' : 'ZiG'}. Raise an expense request for a larger amount.`, 422);
    }
    const e = await tx.finExpense.create({
      data: {
        schoolId: user.schoolId, fundId: fund.id, category, categoryId: cat?.id ?? null, supplierId: input.supplierId ?? null, receiptKey: input.receiptKey || null, description: input.description, payee: input.payee, currency: input.currency, amountCents: input.amount,
        paidOn: dayOf(paidOn), method: input.method, reference: input.reference, source: 'DIRECT', recordedById: user.id,
      },
    });
    await audit(tx, user, 'RECORD_EXPENSE', 'FinExpense', e.id, `Recorded a direct expense: ${input.description} (${fund.name})`, undefined, {
      fundId: fund.id, category, currency: input.currency, amountCents: input.amount, method: input.method, source: 'DIRECT', paidOn,
    });
    return { id: e.id };
  });
}

export async function voidExpense(user: Actor, id: string, rawReason: unknown) {
  need(user, 'finance.expenses.void');
  const reason = whySchema().parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const e = await tx.finExpense.findFirst({ where: { id, schoolId: user.schoolId }, include: { voidRow: true } });
    if (!e) throw new ServiceError('Expense not found', 404);
    if (e.voidRow) throw new ServiceError('This expense was already voided', 409);
    if (e.recordedById === user.id) throw new ServiceError('You recorded this expense, so someone else must void it.', 403);
    const v = await tx.finVoid.create({ data: { schoolId: user.schoolId, expenseId: id, reason, voidedById: user.id } });
    await audit(tx, user, 'VOID_EXPENSE', 'FinExpense', id, `Voided expense ${e.description}: ${reason}`, { amountCents: e.amountCents, currency: e.currency, voided: false }, { voided: true, voidId: v.id, reason });
    return { id, voidId: v.id };
  });
}

export interface ExpenseRow {
  id: string;
  paidOn: string;
  fundId: string;
  fundName: string;
  category: string;
  description: string;
  payee: string | null;
  currency: Cur;
  amountCents: number;
  method: Method;
  reference: string | null;
  source: 'REQUEST' | 'DIRECT' | 'MIGRATED';
  requestNumber: string | null;
  recordedBy: string | null;
  recordedById: string;
  voided: boolean;
  voidReason: string | null;
}

export interface ExpenseFilter { fundId?: string; currency?: Cur; from?: string; to?: string; source?: ExpenseRow['source']; includeVoided?: boolean; page?: number; pageSize?: number }

export async function listExpenses(user: Actor, f: ExpenseFilter = {}) {
  need(user, 'finance.expenses.view', 'finance.expenses.record', 'finance.reports.view');
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.FinExpenseWhereInput = {
      schoolId: user.schoolId, ...(f.fundId ? { fundId: f.fundId } : {}), ...(f.currency ? { currency: f.currency } : {}), ...(f.source ? { source: f.source } : {}),
      ...(f.from || f.to ? { paidOn: { ...(f.from ? { gte: dayOf(f.from) } : {}), ...(f.to ? { lte: dayOf(f.to) } : {}) } } : {}), ...(f.includeVoided ? {} : { voidRow: null }),
    };
    const [total, rows] = await Promise.all([
      tx.finExpense.count({ where }),
      tx.finExpense.findMany({ where, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { fund: { select: { name: true } }, voidRow: { select: { reason: true } }, request: { select: { requestNumber: true } } } }),
    ]);
    const names = await nameMap(tx, user.schoolId, rows.map((r) => r.recordedById));
    const out: ExpenseRow[] = rows.map((r) => ({
      id: r.id, paidOn: ymd(r.paidOn), fundId: r.fundId, fundName: r.fund.name, category: r.category, description: r.description, payee: r.payee, currency: r.currency, amountCents: r.amountCents,
      method: r.method as Method, reference: r.reference, source: r.source, requestNumber: r.request?.requestNumber ?? null, recordedBy: nameOf(names, r.recordedById), recordedById: r.recordedById,
      voided: !!r.voidRow, voidReason: r.voidRow?.reason ?? null,
    }));
    return { rows: out, total, page, pageSize };
  });
}
