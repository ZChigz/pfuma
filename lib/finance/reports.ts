// Finance reports. Every report can be filtered by fund, and every total is kept per currency: US dollars and ZiG are never added.
// Money in means verified, unvoided payments; money out means unvoided expenses and refunds that were paid out.
import { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { dayOf, ensureFunds, need, resolveTerm, todayInHarare, ymd, type Actor } from '@/lib/finance/common';
import { balancesOf, chargeLines, emptyByCurrency, paymentCredits, rollup, sumCells, type ByCurrency } from '@/lib/finance/balances';
import { CURRENCIES, formatMoney, type Cur, type Totals, zeroTotals } from '@/lib/finance/money';

const SEE: PermissionKey[] = ['finance.reports.view'];

/**
 * Money collected in a period, by the fund of the charges it settled (a payment for "any fund" is shared over charges of several funds), and
 * money held as unallocated credit under the payment's own fund (or none). Verified, unvoided payments by receipt date.
 */
export async function collectedByFund(tx: Db, schoolId: string, from: string, to: string, fundId?: string): Promise<{ fundId: string | null; currency: Cur; cents: number }[]> {
  const fundSql = fundId ? Prisma.sql`AND c."fundId" = ${fundId}` : Prisma.empty;
  const settled = await tx.$queryRaw<{ fundId: string; currency: Cur; cents: bigint }[]>(Prisma.sql`
    SELECT c."fundId", c."currency"::text AS "currency", sum(a."amountCents")::bigint AS "cents"
      FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId" JOIN "FinCharge" c ON c."id" = a."chargeId"
     WHERE p."schoolId" = ${schoolId} AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")
       AND p."receivedOn" >= ${from}::date AND p."receivedOn" <= ${to}::date ${fundSql}
     GROUP BY 1, 2`);
  const heldFund = fundId ? Prisma.sql`AND p."fundId" = ${fundId}` : Prisma.empty;
  const held = await tx.$queryRaw<{ fundId: string | null; currency: Cur; cents: bigint }[]>(Prisma.sql`
    SELECT p."fundId", p."currency"::text AS "currency",
           sum(p."amountCents" - COALESCE((SELECT sum(a."amountCents") FROM "FinPaymentAllocation" a WHERE a."paymentId" = p."id"), 0)
               - COALESCE((SELECT sum(r."amountCents") FROM "FinRefund" r WHERE r."paymentId" = p."id" AND r."chargeId" IS NULL AND r."status" <> 'REJECTED'), 0) - fin_transfer_out(p."id"))::bigint AS "cents"
      FROM "FinPayment" p
     WHERE p."schoolId" = ${schoolId} AND p."status" = 'VERIFIED' AND NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")
       AND p."receivedOn" >= ${from}::date AND p."receivedOn" <= ${to}::date ${heldFund}
     GROUP BY 1, 2`);
  return [...settled.map((r) => ({ fundId: r.fundId as string | null, currency: r.currency, cents: Number(r.cents) })), ...held.map((r) => ({ fundId: r.fundId, currency: r.currency, cents: Number(r.cents) })).filter((r) => r.cents > 0)];
}

/** A day range in Harare (UTC+2) as the instants that bound it, for timestamp columns. */
export function harareRange(from: string, to: string): { gte: Date; lt: Date } {
  const start = new Date(dayOf(from).getTime() - 2 * 3600_000);
  const end = new Date(dayOf(to).getTime() + 24 * 3600_000 - 2 * 3600_000);
  return { gte: start, lt: end };
}

function checkRange(from: string, to: string) {
  if (from > to) throw new ServiceError('The start date is after the end date', 422);
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface Overview {
  term: { id: string; name: string; status: string };
  /** Billed, settled and still owed for the term's charges, per currency. */
  charges: ByCurrency;
  /** Credit held on account (all terms), per currency. */
  credit: Totals;
  /** Collected in the term (receipt date inside the term), and spent in it. */
  collected: Totals;
  spent: Totals;
  waiting: { payments: number; paymentTotals: Totals; adjustments: number; refunds: number; requestsToApprove: number; requestsToPay: number };
}

export async function overview(user: Actor, termId?: string): Promise<Overview> {
  need(user, ...SEE, 'finance.accounts.view', 'finance.payments.view', 'finance.payments.verify', 'finance.requests.approve', 'finance.requests.disburse');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    const [lines, credits, collectedRows, spentRows, pending, adjustments, refunds, toApprove, toPay] = await Promise.all([
      chargeLines(tx, user.schoolId, { termId: term.id }),
      paymentCredits(tx, user.schoolId),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, status: 'VERIFIED', voidRow: null, receivedOn: { gte: term.startDate, lte: term.endDate } }, _sum: { amountCents: true } }),
      tx.finExpense.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, voidRow: null, paidOn: { gte: term.startDate, lte: term.endDate } }, _sum: { amountCents: true } }),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finAdjustment.count({ where: { schoolId: user.schoolId, status: 'PENDING' } }),
      tx.finRefund.count({ where: { schoolId: user.schoolId, status: { in: ['REQUESTED', 'APPROVED'] } } }),
      tx.finExpenseRequest.count({ where: { schoolId: user.schoolId, status: 'PENDING' } }),
      tx.finExpenseRequest.count({ where: { schoolId: user.schoolId, status: 'APPROVED' } }),
    ]);
    const charges = sumCells(rollup(lines, [], () => 'all').values());
    const credit = zeroTotals();
    for (const c of credits) credit[c.currency] += c.creditCents;
    const collected = zeroTotals();
    for (const r of collectedRows) collected[r.currency] = r._sum.amountCents ?? 0;
    const spent = zeroTotals();
    for (const r of spentRows) spent[r.currency] = r._sum.amountCents ?? 0;
    const paymentTotals = zeroTotals();
    let payments = 0;
    for (const r of pending) {
      paymentTotals[r.currency] = r._sum.amountCents ?? 0;
      payments += r._count._all;
    }
    return { term: { id: term.id, name: term.name, status: term.status }, charges, credit, collected, spent, waiting: { payments, paymentTotals, adjustments, refunds, requestsToApprove: toApprove, requestsToPay: toPay } };
  });
}

// ─── By fund ─────────────────────────────────────────────────────────────────

export interface FundRow {
  fundId: string;
  fundName: string;
  currency: Cur;
  billed: number;
  adjusted: number;
  collected: number;
  refunded: number;
  spent: number;
  /** Money in − money out for the period. */
  net: number;
  /** Still owed today on the fund's charges (all terms). */
  outstanding: number;
  /** Credit held on account in the fund. */
  credit: number;
}

/** Per fund and currency for a period: billed, collected, refunded, spent, and what is still owed. */
export async function fundSummary(user: Actor, f: { from: string; to: string; fundId?: string }) {
  need(user, ...SEE);
  checkRange(f.from, f.to);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const funds = await ensureFunds(tx, user.schoolId);
    const instants = harareRange(f.from, f.to);
    const fundWhere = f.fundId ? { fundId: f.fundId } : {};
    const [billed, adjusted, collected, refunded, spent, lines, credits] = await Promise.all([
      tx.finCharge.groupBy({ by: ['fundId', 'currency'], where: { schoolId: user.schoolId, voidRow: null, createdAt: instants, ...fundWhere }, _sum: { amountCents: true } }),
      tx.finAdjustment.findMany({ where: { schoolId: user.schoolId, status: 'APPROVED', decidedAt: instants, charge: { voidRow: null, ...fundWhere } }, select: { amountCents: true, charge: { select: { fundId: true, currency: true } } } }),
      collectedByFund(tx, user.schoolId, f.from, f.to, f.fundId),
      tx.finRefund.findMany({ where: { schoolId: user.schoolId, status: 'PAID', paidAt: instants, payment: { voidRow: null, ...fundWhere } }, select: { amountCents: true, payment: { select: { fundId: true, currency: true } } } }),
      tx.finExpense.groupBy({ by: ['fundId', 'currency'], where: { schoolId: user.schoolId, voidRow: null, paidOn: { gte: dayOf(f.from), lte: dayOf(f.to) }, ...fundWhere }, _sum: { amountCents: true } }),
      chargeLines(tx, user.schoolId, { fundId: f.fundId }),
      paymentCredits(tx, user.schoolId, { fundId: f.fundId }),
    ]);
    const rows = new Map<string, FundRow>();
    const slot = (fundId: string, currency: Cur) => {
      const key = `${fundId}|${currency}`;
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { fundId, fundName: fundId ? (funds.find((x) => x.id === fundId)?.name ?? '') : 'Credit not yet placed', currency, billed: 0, adjusted: 0, collected: 0, refunded: 0, spent: 0, net: 0, outstanding: 0, credit: 0 }));
      return r;
    };
    for (const r of billed) slot(r.fundId, r.currency).billed += r._sum.amountCents ?? 0;
    for (const a of adjusted) slot(a.charge.fundId, a.charge.currency).adjusted += a.amountCents;
    for (const r of collected) slot(r.fundId ?? '', r.currency).collected += r.cents;
    for (const r of refunded) slot(r.payment.fundId ?? '', r.payment.currency).refunded += r.amountCents;
    for (const r of spent) slot(r.fundId, r.currency).spent += r._sum.amountCents ?? 0;
    for (const l of lines) slot(l.fundId, l.currency).outstanding += l.outstanding;
    for (const c of credits) slot(c.fundId ?? '', c.currency).credit += c.creditCents;
    const list = Array.from(rows.values()).map((r) => ({ ...r, net: r.collected - r.refunded - r.spent }));
    list.sort((a, b) => funds.findIndex((x) => x.id === a.fundId) - funds.findIndex((x) => x.id === b.fundId) || a.currency.localeCompare(b.currency));
    const totals: Record<Cur, Omit<FundRow, 'fundId' | 'fundName' | 'currency'>> = {
      USD: { billed: 0, adjusted: 0, collected: 0, refunded: 0, spent: 0, net: 0, outstanding: 0, credit: 0 },
      ZIG: { billed: 0, adjusted: 0, collected: 0, refunded: 0, spent: 0, net: 0, outstanding: 0, credit: 0 },
    };
    for (const r of list) for (const k of Object.keys(totals[r.currency]) as (keyof (typeof totals)['USD'])[]) totals[r.currency][k] += r[k];
    return { from: f.from, to: f.to, rows: list, totals };
  });
}

// ─── Cash-up ─────────────────────────────────────────────────────────────────

export interface Warning { code: string; severity: 'warning' | 'info'; message: string }

export interface CashUp {
  from: string;
  to: string;
  /** Verified receipts by payment method and currency. */
  receipts: { method: string; currency: Cur; count: number; cents: number }[];
  receiptsByFund: { fundId: string; fundName: string; currency: Cur; cents: number }[];
  /** Recorded but not yet verified, so not counted. */
  pending: { currency: Cur; count: number; cents: number }[];
  refundsPaid: { method: string; currency: Cur; count: number; cents: number }[];
  expenses: { method: string; currency: Cur; count: number; cents: number }[];
  voids: { payments: number; expenses: number };
  /** Cash receipts − cash expenses − cash refunds, per currency: what should be in the till. */
  expectedCash: Totals;
  warnings: Warning[];
}

/** The day's (or period's) takings, by method, currency and fund; with the warnings a reviewer must see. */
export async function cashUp(user: Actor, f: { from?: string; to?: string; fundId?: string } = {}): Promise<CashUp> {
  need(user, ...SEE);
  const from = f.from ?? todayInHarare();
  const to = f.to ?? from;
  checkRange(from, to);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const funds = await ensureFunds(tx, user.schoolId);
    const instants = harareRange(from, to);
    const dateWhere = { gte: dayOf(from), lte: dayOf(to) };
    const fundWhere = f.fundId ? { fundId: f.fundId } : {};
    const [receipts, byFund, pending, refunds, expenses, voidedPayments, voidedExpenses, fallback, verifiers] = await Promise.all([
      tx.finPayment.groupBy({ by: ['method', 'currency'], where: { schoolId: user.schoolId, status: 'VERIFIED', voidRow: null, receivedOn: dateWhere, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      collectedByFund(tx, user.schoolId, from, to, f.fundId),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null, receivedOn: dateWhere, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finRefund.findMany({ where: { schoolId: user.schoolId, status: 'PAID', paidAt: instants, payment: { voidRow: null, ...fundWhere } }, select: { amountCents: true, method: true, payment: { select: { currency: true } } } }),
      tx.finExpense.groupBy({ by: ['method', 'currency'], where: { schoolId: user.schoolId, voidRow: null, paidOn: dateWhere, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finVoid.count({ where: { schoolId: user.schoolId, voidedAt: instants, paymentId: { not: null }, ...(f.fundId ? { payment: { fundId: f.fundId } } : {}) } }),
      tx.finVoid.count({ where: { schoolId: user.schoolId, voidedAt: instants, expenseId: { not: null }, ...(f.fundId ? { expense: { fundId: f.fundId } } : {}) } }),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, status: 'VERIFIED', verifierFallback: true, voidRow: null, receivedOn: dateWhere, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.user.count({ where: { schoolId: user.schoolId, active: true, isSupport: false, userRoles: { some: { role: { permissions: { some: { permissionKey: 'finance.payments.verify' } } } } } } }),
    ]);

    const refundGroups = new Map<string, { method: string; currency: Cur; count: number; cents: number }>();
    for (const r of refunds) {
      const key = `${r.method ?? 'CASH'}|${r.payment.currency}`;
      const g = refundGroups.get(key) ?? { method: r.method ?? 'CASH', currency: r.payment.currency, count: 0, cents: 0 };
      g.count += 1;
      g.cents += r.amountCents;
      refundGroups.set(key, g);
    }
    const expectedCash = zeroTotals();
    for (const r of receipts) if (r.method === 'CASH') expectedCash[r.currency] += r._sum.amountCents ?? 0;
    for (const r of expenses) if (r.method === 'CASH') expectedCash[r.currency] -= r._sum.amountCents ?? 0;
    for (const g of Array.from(refundGroups.values())) if (g.method === 'CASH') expectedCash[g.currency] -= g.cents;

    const warnings: Warning[] = [];
    if (fallback.length) {
      const count = fallback.reduce((s, r) => s + r._count._all, 0);
      const amounts = fallback.map((r) => formatMoney(r._sum.amountCents ?? 0, r.currency)).join(' and ');
      warnings.push({
        code: 'OWNER_VERIFIED', severity: 'warning',
        message: `${count} payment${count === 1 ? ' was' : 's were'} verified by the Owner or an Administrator (${amounts}) because the school has no other finance person to verify. `
          + 'Appoint a Bursar or the Head to verify payments, so that the person who records money and the person who checks it are always two different people.',
      });
    }
    if (verifiers === 0) {
      warnings.push({ code: 'NO_VERIFIER', severity: 'warning', message: 'Nobody holds the permission to verify payments except the Owner and Administrators. Give it to the Bursar or the Head in System, Roles.' });
    }
    const pendingCount = pending.reduce((s, r) => s + r._count._all, 0);
    if (pendingCount) {
      warnings.push({ code: 'UNVERIFIED', severity: 'info', message: `${pendingCount} payment${pendingCount === 1 ? ' is' : 's are'} recorded but not yet verified, so ${pendingCount === 1 ? 'it is' : 'they are'} not counted above.` });
    }
    if (voidedPayments + voidedExpenses) {
      warnings.push({ code: 'VOIDS', severity: 'info', message: `${voidedPayments} payment(s) and ${voidedExpenses} expense(s) were voided in this period.` });
    }

    const sorted = <T extends { currency: Cur; method: string }>(rows: T[]) => rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.method.localeCompare(b.method));
    return {
      from, to,
      receipts: sorted(receipts.map((r) => ({ method: r.method, currency: r.currency, count: r._count._all, cents: r._sum.amountCents ?? 0 }))),
      receiptsByFund: byFund.map((r) => ({ fundId: r.fundId ?? '', fundName: r.fundId ? (funds.find((x) => x.id === r.fundId)?.name ?? '') : 'Not yet placed (credit)', currency: r.currency, cents: r.cents })),
      pending: pending.map((r) => ({ currency: r.currency, count: r._count._all, cents: r._sum.amountCents ?? 0 })),
      refundsPaid: sorted(Array.from(refundGroups.values())),
      expenses: sorted(expenses.map((r) => ({ method: r.method, currency: r.currency, count: r._count._all, cents: r._sum.amountCents ?? 0 }))),
      voids: { payments: voidedPayments, expenses: voidedExpenses },
      expectedCash,
      warnings,
    };
  });
}

// ─── Arrears ─────────────────────────────────────────────────────────────────

export interface ArrearsRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  className: string | null;
  balances: ByCurrency;
}

/** Students who owe money, per currency. `fundId` narrows it to one fund; `termId` counts charges up to and including that term. */
export async function arrears(user: Actor, f: { termId?: string; classId?: string; levelId?: string; fundId?: string; currency?: Cur; minCents?: number } = {}) {
  need(user, ...SEE, 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, f.termId);
    const studentWhere: Prisma.StudentWhereInput = { schoolId: user.schoolId };
    if (f.classId) studentWhere.currentClassId = f.classId;
    if (f.levelId) studentWhere.currentClass = { levelId: f.levelId };
    const scoped = f.classId || f.levelId ? (await tx.student.findMany({ where: studentWhere, select: { id: true } })).map((s) => s.id) : undefined;
    const balances = await balancesOf(tx, user.schoolId, { studentIds: scoped, fundId: f.fundId, currency: f.currency, upTo: term.startDate });
    const min = f.minCents ?? 1;
    const owing = Array.from(balances.entries()).filter(([, b]) => CURRENCIES.some((c) => (!f.currency || c === f.currency) && b[c].outstanding >= min));
    const students = owing.length
      ? await tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: owing.map(([id]) => id) } }, select: { id: true, fullName: true, admissionNumber: true, currentClassId: true } })
      : [];
    const classes = await tx.schoolClass.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } });
    const className = new Map(classes.map((c) => [c.id, c.name]));
    const info = new Map(students.map((s) => [s.id, s]));
    const rows: ArrearsRow[] = owing
      .flatMap(([id, b]) => {
        const s = info.get(id);
        return s ? [{ studentId: id, name: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClassId ? (className.get(s.currentClassId) ?? null) : null, balances: b }] : [];
      })
      .sort((a, b) => b.balances.USD.outstanding - a.balances.USD.outstanding || b.balances.ZIG.outstanding - a.balances.ZIG.outstanding || a.name.localeCompare(b.name));
    const totals = sumCells(rows.map((r) => r.balances));
    return { term: { id: term.id, name: term.name }, rows, totals, students: rows.length };
  });
}

// ─── Spending ────────────────────────────────────────────────────────────────

export async function expenditure(user: Actor, f: { from: string; to: string; fundId?: string }) {
  need(user, ...SEE, 'finance.expenses.view');
  checkRange(f.from, f.to);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const funds = await ensureFunds(tx, user.schoolId);
    const rows = await tx.finExpense.groupBy({
      by: ['fundId', 'category', 'currency'],
      where: { schoolId: user.schoolId, voidRow: null, paidOn: { gte: dayOf(f.from), lte: dayOf(f.to) }, ...(f.fundId ? { fundId: f.fundId } : {}) },
      _sum: { amountCents: true }, _count: { _all: true },
    });
    const totals = zeroTotals();
    const out = rows
      .map((r) => ({ fundId: r.fundId, fundName: funds.find((x) => x.id === r.fundId)?.name ?? '', category: r.category, currency: r.currency as Cur, count: r._count._all, cents: r._sum.amountCents ?? 0 }))
      .sort((a, b) => a.fundName.localeCompare(b.fundName) || a.currency.localeCompare(b.currency) || b.cents - a.cents);
    for (const r of out) totals[r.currency] += r.cents;
    return { from: f.from, to: f.to, rows: out, totals };
  });
}

export { ymd, emptyByCurrency };
