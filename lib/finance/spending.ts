// What surrounds spending: suppliers, expense categories (editable), budgets per category and fund and term, and petty cash floats. Plus the
// fund's position for the people who approve requests: what the fund holds and what has been spent this term against its budget.
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import {
  amountSchema, audit, currencySchema, dayOf, ensureFunds, idSchema, isoDateSchema, need, nameMap, nameOf, resolveTerm, textSchema, todayInHarare, ymd, type Actor,
} from '@/lib/finance/common';
import { zeroTotals, type Cur, type Totals } from '@/lib/finance/money';

const n = (v: unknown) => Number(v ?? 0);

// ─── The fund's position ─────────────────────────────────────────────────────

export interface FundBudgetView { fundHoldsCents: number; spentThisTermCents: number; budgetThisTermCents: number | null; termName: string | null }

/** What a fund holds (collected and held as credit, less refunds and spending) and this term's spending against its budget, in one currency. */
export async function fundBudgetView(tx: Db, schoolId: string, fundId: string, currency: Cur): Promise<FundBudgetView> {
  const [inRows, outRows, term] = await Promise.all([
    tx.$queryRaw<{ cents: bigint }[]>(Prisma.sql`
      SELECT (
        COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId" JOIN "FinCharge" c ON c."id" = a."chargeId"
                   WHERE c."schoolId" = ${schoolId} AND c."fundId" = ${fundId} AND c."currency" = ${currency}::"Currency" AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")), 0)
        + COALESCE((SELECT sum(p."amountCents" - COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0)
                                               - COALESCE((SELECT sum(r."amountCents") FROM "FinRefund" r WHERE r."paymentId" = p."id" AND r."chargeId" IS NULL AND r."status" <> 'REJECTED'), 0) - fin_transfer_out(p."id"))
                      FROM "FinPayment" p WHERE p."schoolId" = ${schoolId} AND p."fundId" = ${fundId} AND p."currency" = ${currency}::"Currency" AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")), 0)
      )::bigint AS "cents"`),
    tx.$queryRaw<{ cents: bigint }[]>(Prisma.sql`
      SELECT (
        COALESCE((SELECT sum(r."amountCents") FROM "FinRefund" r JOIN "FinPayment" p ON p."id" = r."paymentId" LEFT JOIN "FinCharge" c ON c."id" = r."chargeId"
                   WHERE r."schoolId" = ${schoolId} AND r."status" = 'PAID' AND p."currency" = ${currency}::"Currency" AND COALESCE(c."fundId", p."fundId") = ${fundId}), 0)
        + COALESCE((SELECT sum(e."amountCents") FROM "FinExpense" e WHERE e."schoolId" = ${schoolId} AND e."fundId" = ${fundId} AND e."currency" = ${currency}::"Currency" AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."expenseId" = e."id")), 0)
      )::bigint AS "cents"`),
    tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true, name: true, startDate: true, endDate: true } }),
  ]);
  let spent = 0; let budget: number | null = null;
  if (term) {
    const [s, b] = await Promise.all([
      tx.finExpense.aggregate({ where: { schoolId, fundId, currency, voidRow: null, paidOn: { gte: term.startDate, lte: term.endDate } }, _sum: { amountCents: true } }),
      tx.budget.aggregate({ where: { schoolId, termId: term.id, fundId, currency }, _sum: { amountCents: true }, _count: { _all: true } }),
    ]);
    spent = s._sum.amountCents ?? 0;
    budget = b._count._all ? (b._sum.amountCents ?? 0) : null;
  }
  return { fundHoldsCents: n(inRows[0]?.cents) - n(outRows[0]?.cents), spentThisTermCents: spent, budgetThisTermCents: budget, termName: term?.name ?? null };
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export const SupplierSchema = z.object({
  name: textSchema('a name', 1, 80), contact: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional(), bankDetails: z.string().trim().max(200).optional(),
  ecocash: z.string().trim().max(30).optional(), taxNumber: z.string().trim().max(40).optional(), active: z.boolean().optional(),
});

export async function listSuppliers(user: Actor) {
  need(user, 'finance.suppliers.manage', 'finance.expenses.record', 'finance.expenses.manage', 'finance.requests.create', 'finance.requests.disburse', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.supplier.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } });
    return rows.map((s) => ({ id: s.id, name: s.name, contact: s.contact, phone: s.phone, bankDetails: s.bankDetails, ecocash: s.ecocash, taxNumber: s.taxNumber, active: s.active }));
  });
}

export async function saveSupplier(user: Actor, id: string | null, raw: unknown) {
  need(user, 'finance.suppliers.manage');
  const input = (id ? SupplierSchema.partial() : SupplierSchema).parse(raw) as z.infer<typeof SupplierSchema>;
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (input.name && (await tx.supplier.findFirst({ where: { schoolId: user.schoolId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ServiceError(`There is already a supplier called ${input.name}`, 409);
    }
    const data = { name: input.name, contact: input.contact || null, phone: input.phone || null, bankDetails: input.bankDetails || null, ecocash: input.ecocash || null, taxNumber: input.taxNumber || null, active: input.active };
    if (!id) {
      const s = await tx.supplier.create({ data: { ...data, schoolId: user.schoolId, name: input.name } });
      await audit(tx, user, 'SAVE_SUPPLIER', 'Supplier', s.id, `Added supplier ${s.name}`, undefined, { name: s.name });
      return { id: s.id };
    }
    const before = await tx.supplier.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Supplier not found', 404);
    const after = await tx.supplier.update({ where: { id }, data });
    await audit(tx, user, 'SAVE_SUPPLIER', 'Supplier', id, `Changed supplier ${before.name}`, { name: before.name, active: before.active }, { name: after.name, active: after.active });
    return { id };
  });
}

/** Spending per supplier in a period, per currency. */
export async function supplierSpend(user: Actor, f: { from: string; to: string }) {
  need(user, 'finance.reports.view', 'finance.suppliers.manage');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.finExpense.groupBy({ by: ['supplierId', 'currency'], where: { schoolId: user.schoolId, voidRow: null, supplierId: { not: null }, paidOn: { gte: dayOf(f.from), lte: dayOf(f.to) } }, _sum: { amountCents: true }, _count: { _all: true } });
    const sup = new Map((await tx.supplier.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return rows.map((r) => ({ supplierId: r.supplierId!, supplier: sup.get(r.supplierId!) ?? '', currency: r.currency as Cur, count: r._count._all, cents: r._sum.amountCents ?? 0 })).sort((a, b) => a.supplier.localeCompare(b.supplier) || a.currency.localeCompare(b.currency));
  });
}

// ─── Expense categories ──────────────────────────────────────────────────────

export async function listCategories(user: Actor) {
  need(user, 'finance.expenses.record', 'finance.expenses.manage', 'finance.expenses.view', 'finance.requests.disburse', 'finance.budgets.manage', 'finance.reports.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureFunds(tx, user.schoolId);
    const rows = await tx.expenseCategory.findMany({ where: { schoolId: user.schoolId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return rows.map((c) => ({ id: c.id, name: c.name, active: c.active }));
  });
}

export const CategorySchema = z.object({ name: textSchema('a name', 1, 60), active: z.boolean().optional() });

export async function saveCategory(user: Actor, id: string | null, raw: unknown) {
  need(user, 'finance.expenses.manage');
  const input = (id ? CategorySchema.partial() : CategorySchema).parse(raw) as z.infer<typeof CategorySchema>;
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await ensureFunds(tx, user.schoolId);
    if (input.name && (await tx.expenseCategory.findFirst({ where: { schoolId: user.schoolId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } }))) {
      throw new ServiceError(`There is already a category called ${input.name}`, 409);
    }
    if (!id) {
      const c = await tx.expenseCategory.create({ data: { schoolId: user.schoolId, name: input.name, sortOrder: await tx.expenseCategory.count({ where: { schoolId: user.schoolId } }) } });
      await audit(tx, user, 'SAVE_EXPENSE_CATEGORY', 'ExpenseCategory', c.id, `Added expense category ${c.name}`, undefined, { name: c.name });
      return { id: c.id };
    }
    const before = await tx.expenseCategory.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Category not found', 404);
    const after = await tx.expenseCategory.update({ where: { id }, data: { name: input.name, active: input.active } });
    await audit(tx, user, 'SAVE_EXPENSE_CATEGORY', 'ExpenseCategory', id, `Changed expense category ${before.name}`, { name: before.name, active: before.active }, { name: after.name, active: after.active });
    return { id };
  });
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export const BudgetSchema = z.object({ termId: idSchema.optional(), fundId: idSchema, categoryId: idSchema, currency: currencySchema, amount: z.union([z.string(), z.number()]) });

export async function saveBudget(user: Actor, raw: unknown) {
  need(user, 'finance.budgets.manage');
  const input = BudgetSchema.parse(raw);
  const amountCents = amountSchema.or(z.literal(0)).parse(input.amount);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, input.termId);
    if (term.status === 'CLOSED') throw new ServiceError(`${term.name} is closed, so its budget cannot be changed`, 409);
    const [fund, cat] = await Promise.all([tx.fund.findFirst({ where: { id: input.fundId, schoolId: user.schoolId } }), tx.expenseCategory.findFirst({ where: { id: input.categoryId, schoolId: user.schoolId } })]);
    if (!fund || !cat) throw new ServiceError('Fund or category not found', 404);
    const key = { termId: term.id, fundId: fund.id, categoryId: cat.id, currency: input.currency };
    const before = await tx.budget.findUnique({ where: { termId_fundId_categoryId_currency: key } });
    const b = await tx.budget.upsert({ where: { termId_fundId_categoryId_currency: key }, update: { amountCents }, create: { schoolId: user.schoolId, ...key, amountCents } });
    await audit(tx, user, 'SAVE_BUDGET', 'Budget', b.id, `Set the ${cat.name} budget of the ${fund.name} fund for ${term.name}`, before ? { amountCents: before.amountCents } : undefined, { amountCents, currency: input.currency });
    return { id: b.id };
  });
}

export interface BudgetRow { fundId: string; fundName: string; categoryId: string; category: string; currency: Cur; budgetCents: number; spentCents: number; remainingCents: number }

/** Each budget line of a term with what has been spent against it (expenses of that category, fund and currency, by date paid). */
export async function budgetReport(user: Actor, termId?: string) {
  need(user, 'finance.budgets.manage', 'finance.reports.view', 'finance.expenses.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const [budgets, funds, cats] = await Promise.all([
      tx.budget.findMany({ where: { schoolId: user.schoolId, termId: term.id } }),
      tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      tx.expenseCategory.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
    ]);
    const spent = await tx.finExpense.groupBy({
      by: ['fundId', 'categoryId', 'category', 'currency'], where: { schoolId: user.schoolId, voidRow: null, paidOn: { gte: term.startDate, lte: term.endDate } }, _sum: { amountCents: true },
    });
    const fn = new Map(funds.map((f) => [f.id, f.name])); const cn = new Map(cats.map((c) => [c.id, c.name]));
    const rows: BudgetRow[] = budgets.map((b) => {
      const s = spent.filter((x) => x.fundId === b.fundId && x.categoryId === b.categoryId && x.currency === b.currency).reduce((t, x) => t + (x._sum.amountCents ?? 0), 0);
      return { fundId: b.fundId, fundName: fn.get(b.fundId) ?? '', categoryId: b.categoryId, category: cn.get(b.categoryId) ?? '', currency: b.currency, budgetCents: b.amountCents, spentCents: s, remainingCents: b.amountCents - s };
    });
    // Spending in a category that has no budget line is shown too, so nothing is hidden.
    for (const x of spent) {
      if (budgets.some((b) => b.fundId === x.fundId && b.categoryId === x.categoryId && b.currency === x.currency)) continue;
      rows.push({ fundId: x.fundId, fundName: fn.get(x.fundId) ?? '', categoryId: x.categoryId ?? '', category: x.categoryId ? (cn.get(x.categoryId) ?? x.category) : x.category, currency: x.currency, budgetCents: 0, spentCents: x._sum.amountCents ?? 0, remainingCents: -(x._sum.amountCents ?? 0) });
    }
    rows.sort((a, b) => a.fundName.localeCompare(b.fundName) || a.category.localeCompare(b.category) || a.currency.localeCompare(b.currency));
    return { term: { id: term.id, name: term.name }, rows };
  });
}

// ─── Petty cash ──────────────────────────────────────────────────────────────

export const FloatSchema = z.object({ custodianId: idSchema, currency: currencySchema, expenseLimit: amountSchema });

export async function createFloat(user: Actor, raw: unknown) {
  need(user, 'finance.expenses.manage');
  const input = FloatSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const person = await tx.user.findFirst({ where: { id: input.custodianId, schoolId: user.schoolId, active: true, isSupport: false }, select: { id: true, fullName: true } });
    if (!person) throw new ServiceError('Person not found', 404);
    if (await tx.pettyCashFloat.findFirst({ where: { custodianId: person.id, currency: input.currency } })) throw new ServiceError(`${person.fullName} already holds a ${input.currency} float`, 409);
    const f = await tx.pettyCashFloat.create({ data: { schoolId: user.schoolId, custodianId: person.id, currency: input.currency, expenseLimitCents: input.expenseLimit } });
    await audit(tx, user, 'PETTY_CASH', 'PettyCashFloat', f.id, `Gave ${person.fullName} a ${input.currency} petty cash float`, undefined, { custodianId: person.id, currency: input.currency, expenseLimitCents: input.expenseLimit });
    return { id: f.id };
  });
}

export const PettySchema = z.object({
  floatId: idSchema, kind: z.enum(['TOPUP', 'EXPENSE']), amount: amountSchema, description: textSchema('what it is for', 3, 160), categoryId: idSchema.optional(),
  receiptKey: z.string().trim().max(200).optional(), date: isoDateSchema.optional(),
});

/** A top-up (from the bursar to the custodian) or a small expense paid from the float. */
export async function petty(user: Actor, raw: unknown) {
  need(user, 'finance.expenses.manage', 'finance.expenses.record');
  const input = PettySchema.parse(raw);
  const date = input.date ?? todayInHarare();
  if (date > todayInHarare()) throw new ServiceError('The date cannot be in the future', 422);
  if (input.receiptKey && !proofKeyBelongsTo(input.receiptKey, user.schoolId)) throw new ServiceError('That receipt does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const f = await tx.pettyCashFloat.findFirst({ where: { id: input.floatId, schoolId: user.schoolId, active: true }, include: { entries: { select: { kind: true, amountCents: true } } } });
    if (!f) throw new ServiceError('Float not found', 404);
    if (input.kind === 'TOPUP' && f.custodianId === user.id) throw new ServiceError('You hold this float, so someone else must top it up.', 403);
    if (input.kind === 'EXPENSE' && f.custodianId !== user.id) throw new ServiceError('Only the person holding the float spends from it', 403);
    const balance = f.entries.reduce((s, e) => s + (e.kind === 'TOPUP' ? e.amountCents : -e.amountCents), 0);
    if (input.kind === 'EXPENSE') {
      if (input.amount > f.expenseLimitCents) throw new ServiceError(`A petty cash expense is at most ${(f.expenseLimitCents / 100).toFixed(2)}. Use an expense request for more.`, 422);
      if (input.amount > balance) throw new ServiceError(`The float holds only ${(balance / 100).toFixed(2)}`, 409);
    }
    const e = await tx.pettyCashEntry.create({ data: { schoolId: user.schoolId, floatId: f.id, kind: input.kind, amountCents: input.amount, description: input.description, categoryId: input.categoryId ?? null, receiptKey: input.receiptKey || null, date: dayOf(date), byId: user.id } });
    await audit(tx, user, 'PETTY_CASH', 'PettyCashEntry', e.id, `${input.kind === 'TOPUP' ? 'Topped up' : 'Spent from'} a ${f.currency} petty cash float: ${input.description}`, { balanceCents: balance }, { kind: input.kind, amountCents: input.amount, balanceCents: balance + (input.kind === 'TOPUP' ? input.amount : -input.amount) });
    return { id: e.id, balanceCents: balance + (input.kind === 'TOPUP' ? input.amount : -input.amount) };
  });
}

export async function listFloats(user: Actor) {
  need(user, 'finance.expenses.manage', 'finance.expenses.record', 'finance.expenses.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.pettyCashFloat.findMany({ where: { schoolId: user.schoolId }, include: { entries: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 30 } } });
    const all = await tx.pettyCashEntry.groupBy({ by: ['floatId', 'kind'], where: { schoolId: user.schoolId }, _sum: { amountCents: true } });
    const names = await nameMap(tx, user.schoolId, rows.map((r) => r.custodianId));
    return rows.map((f) => ({
      id: f.id, custodianId: f.custodianId, custodian: nameOf(names, f.custodianId), currency: f.currency as Cur, expenseLimitCents: f.expenseLimitCents, active: f.active,
      balanceCents: all.filter((a) => a.floatId === f.id).reduce((s, a) => s + (a.kind === 'TOPUP' ? 1 : -1) * (a._sum.amountCents ?? 0), 0),
      entries: f.entries.map((e) => ({ id: e.id, kind: e.kind, amountCents: e.amountCents, description: e.description, date: ymd(e.date) })),
    }));
  });
}

/** Petty cash spent by one custodian on one day, per currency (the cash-up subtracts it from the cash the drawer should hold). */
export async function pettySpentOn(tx: Db, schoolId: string, userId: string, date: Date): Promise<Totals> {
  const rows = await tx.pettyCashEntry.findMany({ where: { schoolId, byId: userId, kind: 'EXPENSE', date }, select: { amountCents: true, float: { select: { currency: true } } } });
  const t = zeroTotals();
  for (const r of rows) t[r.float.currency] += r.amountCents;
  return t;
}
