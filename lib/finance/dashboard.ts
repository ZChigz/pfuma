// The Finance dashboard: the bursar's and Head's daily questions for one term, optionally for one fund. Every figure is per currency.
// Built from the same ledger rows as every other report (lib/finance/balances.ts), so it can never disagree with a statement.
import { Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { dayOf, ensureFunds, need, todayInHarare, ymd, type Actor } from '@/lib/finance/common';
import { chargeLines } from '@/lib/finance/balances';
import { CURRENCIES, zeroTotals, type Cur, type Totals } from '@/lib/finance/money';
import { methodBucket } from '@/lib/finance/methods';


const n = (v: unknown) => Number(v ?? 0);
const DAY = 86_400_000;

export interface Pct { rate: number | null; lastTermRate: number | null }
export interface FinanceDashboard {
  term: { id: string; name: string; status: string; startDate: string; endDate: string };
  lastTerm: { id: string; name: string } | null;
  terms: { id: string; name: string }[];
  fund: { id: string; name: string } | null;
  billed: Totals;
  collected: Totals;
  /** Collected ÷ billed per currency, with last term's figure up to the same day of its term. */
  collectionRate: Record<Cur, Pct>;
  outstanding: { thisTerm: Totals; earlier: Totals };
  today: { collected: Totals; pending: Totals; pendingCount: number };
  owing: { learners: number; moreThanOneTerm: number };
  weekly: { week: number; thisTerm: Totals; lastTerm: Totals }[];
  byForm: { form: string; outstanding: Totals }[];
  byMethod: { method: string; totals: Totals; count: number }[];
  /** The same payments grouped as Cash, EcoCash, Bank, Paynow and Others. */
  byBucket: { bucket: string; totals: Totals; count: number }[];
  /** Today's cash-up for each person who took payments today. */
  cashUps: { userId: string; name: string; status: 'NOT_STARTED' | 'SUBMITTED' | 'SIGNED_OFF' }[];
  /** Money owed by sponsors (BEAM and others): the total per currency and the oldest term still unpaid. */
  sponsorsOwe: { total: Totals; oldestUnpaidTerm: string | null; sponsors: number };
  staleRate: boolean;
  waiting: {
    payments: { count: number; totals: Totals; oldest: { id: string; receiptNumber: string | null; student: string; receivedOn: string; currency: Cur; amountCents: number }[] };
    requestsToApprove: number;
    requestsToPay: number;
  };
}

/** Verified, unvoided payment money settling a term's charges, by week of the receipt date (week 1 = the term's first 7 days). */
async function weeklyCollections(tx: Db, schoolId: string, termId: string, start: Date, fundId?: string, cutoff?: Date) {
  const where: Prisma.Sql[] = [
    Prisma.sql`c."schoolId" = ${schoolId}`, Prisma.sql`c."termId" = ${termId}`, Prisma.sql`p."status" = 'VERIFIED'`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."paymentId" = p."id")`, Prisma.sql`NOT EXISTS (SELECT 1 FROM "FinVoid" v WHERE v."chargeId" = c."id")`,
  ];
  if (fundId) where.push(Prisma.sql`c."fundId" = ${fundId}`);
  if (cutoff) where.push(Prisma.sql`p."receivedOn" <= ${cutoff}`);
  const rows = await tx.$queryRaw<{ week: number; currency: Cur; cents: bigint }[]>(Prisma.sql`
    SELECT GREATEST(0, floor((p."receivedOn" - ${start}::date) / 7.0))::int + 1 AS "week", c."currency"::text AS "currency", sum(a."amountCents")::bigint AS "cents"
      FROM "FinPaymentAllocation" a JOIN "FinPayment" p ON p."id" = a."paymentId" JOIN "FinCharge" c ON c."id" = a."chargeId"
     WHERE ${Prisma.join(where, ' AND ')} GROUP BY 1, 2 ORDER BY 1`);
  return rows.map((r) => ({ week: r.week, currency: r.currency, cents: n(r.cents) }));
}

export async function financeDashboard(user: Actor, f: { termId?: string; fundId?: string } = {}): Promise<FinanceDashboard> {
  need(user, 'finance.reports.view', 'finance.payments.verify', 'finance.accounts.view', 'finance.requests.approve', 'finance.requests.disburse');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sid = user.schoolId;
    const terms = await tx.academicTerm.findMany({ where: { schoolId: sid }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } });
    const term = terms.find((t) => t.id === f.termId) ?? terms.find((t) => t.status === 'OPEN') ?? terms[0];
    if (!term) throw Object.assign(new Error('No term yet'), { status: 409 });
    const lastTerm = terms.filter((t) => t.startDate < term.startDate)[0] ?? null; // newest first, so the first earlier one is the previous term
    const funds = await ensureFunds(tx, sid);
    const fund = funds.find((x) => x.id === f.fundId) ?? null;
    const today = todayInHarare();
    const todayDate = dayOf(today);

    const lines = await chargeLines(tx, sid, { fundId: fund?.id, upTo: term.startDate });
    const mine = lines.filter((l) => l.termId === term.id);
    const earlier = lines.filter((l) => l.termId !== term.id); // the query stops at this term, so these are earlier terms

    const billed = zeroTotals();
    const collected = zeroTotals();
    const out = zeroTotals();
    const arrears = zeroTotals();
    for (const l of mine) {
      billed[l.currency] += l.charged - l.adjusted;
      collected[l.currency] += l.paid - l.refunded;
      out[l.currency] += l.outstanding;
    }
    for (const l of earlier) arrears[l.currency] += l.outstanding;

    // Last term's rate up to the same day of its term, for the comparison.
    const elapsed = Math.max(0, Math.min(Math.floor((todayDate.getTime() - term.startDate.getTime()) / DAY), Math.floor((term.endDate.getTime() - term.startDate.getTime()) / DAY)));
    const lastRate: Record<Cur, number | null> = { USD: null, ZIG: null };
    let weeklyLast: { week: number; currency: Cur; cents: number }[] = [];
    if (lastTerm) {
      const lastLines = await chargeLines(tx, sid, { fundId: fund?.id, termId: lastTerm.id });
      const lastBilled = zeroTotals();
      for (const l of lastLines) lastBilled[l.currency] += l.charged - l.adjusted;
      const cutoff = new Date(lastTerm.startDate.getTime() + elapsed * DAY);
      const upToDay = await weeklyCollections(tx, sid, lastTerm.id, lastTerm.startDate, fund?.id, cutoff);
      for (const c of CURRENCIES) {
        const got = upToDay.filter((r) => r.currency === c).reduce((s, r) => s + r.cents, 0);
        lastRate[c] = lastBilled[c] > 0 ? Math.round((got / lastBilled[c]) * 1000) / 10 : null;
      }
      weeklyLast = await weeklyCollections(tx, sid, lastTerm.id, lastTerm.startDate, fund?.id);
    }
    const weeklyThis = await weeklyCollections(tx, sid, term.id, term.startDate, fund?.id);
    const weekCount = Math.max(1, Math.ceil(((term.endDate.getTime() - term.startDate.getTime()) / DAY + 1) / 7), ...weeklyThis.map((w) => w.week), ...weeklyLast.map((w) => w.week));
    const weekly = Array.from({ length: weekCount }, (_, i) => {
      const row = { week: i + 1, thisTerm: zeroTotals(), lastTerm: zeroTotals() };
      for (const w of weeklyThis) if (w.week === i + 1) row.thisTerm[w.currency] += w.cents;
      for (const w of weeklyLast) if (w.week === i + 1) row.lastTerm[w.currency] += w.cents;
      return row;
    });

    // Learners owing, and owing for more than one term.
    const byStudent = new Map<string, { owed: Set<string>; any: boolean }>();
    for (const l of lines) {
      if (l.outstanding <= 0) continue;
      const s = byStudent.get(l.studentId) ?? { owed: new Set<string>(), any: true };
      s.owed.add(l.termId);
      byStudent.set(l.studentId, s);
    }
    const owingIds = Array.from(byStudent.keys());
    const students = owingIds.length ? await tx.student.findMany({ where: { schoolId: sid, id: { in: owingIds } }, select: { id: true, currentClass: { select: { level: { select: { name: true, order: true } } } } } }) : [];
    const formOf = new Map(students.map((s) => [s.id, s.currentClass?.level ?? null]));
    const forms = new Map<string, { order: number; outstanding: Totals }>();
    for (const l of lines) {
      if (l.outstanding <= 0) continue;
      const lv = formOf.get(l.studentId);
      const key = lv?.name ?? 'No class';
      const row = forms.get(key) ?? { order: lv?.order ?? 99, outstanding: zeroTotals() };
      row.outstanding[l.currency] += l.outstanding;
      forms.set(key, row);
    }

    // Money in today, and the term's payments by method.
    const fundWhere = fund ? { fundId: fund.id } : {};
    const [todayVerified, todayPending, methods, pendingAll, pendingOldest, toApprove, toPay] = await Promise.all([
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: sid, status: 'VERIFIED', voidRow: null, receivedOn: todayDate, ...fundWhere }, _sum: { amountCents: true } }),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: sid, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null, receivedOn: todayDate, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finPayment.groupBy({ by: ['method', 'currency'], where: { schoolId: sid, status: 'VERIFIED', voidRow: null, receivedOn: { gte: term.startDate, lte: term.endDate }, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finPayment.groupBy({ by: ['currency'], where: { schoolId: sid, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null, ...fundWhere }, _sum: { amountCents: true }, _count: { _all: true } }),
      tx.finPayment.findMany({ where: { schoolId: sid, status: { in: ['PENDING', 'RECEIVED'] }, voidRow: null, ...fundWhere }, orderBy: [{ receivedOn: 'asc' }, { recordedAt: 'asc' }], take: 5, select: { id: true, receiptNumber: true, receivedOn: true, currency: true, amountCents: true, student: { select: { fullName: true } } } }),
      tx.finExpenseRequest.count({ where: { schoolId: sid, status: 'PENDING', ...fundWhere } }),
      tx.finExpenseRequest.count({ where: { schoolId: sid, status: 'APPROVED', ...fundWhere } }),
    ]);
    const tot = (rows: { currency: Cur; _sum: { amountCents: number | null } }[]) => {
      const t = zeroTotals();
      for (const r of rows) t[r.currency] += r._sum.amountCents ?? 0;
      return t;
    };
    const methodMap = new Map<string, { totals: Totals; count: number }>();
    for (const m of methods) {
      const row = methodMap.get(m.method) ?? { totals: zeroTotals(), count: 0 };
      row.totals[m.currency] += m._sum.amountCents ?? 0;
      row.count += m._count._all;
      methodMap.set(m.method, row);
    }

    const bucketMap = new Map<string, { totals: Totals; count: number }>();
    for (const [method, v] of Array.from(methodMap.entries())) {
      const b = methodBucket(method);
      const row = bucketMap.get(b) ?? { totals: zeroTotals(), count: 0 };
      for (const c of CURRENCIES) row.totals[c] += v.totals[c];
      row.count += v.count;
      bucketMap.set(b, row);
    }

    // Each person who took payments today, and where their cash-up stands.
    const takers = await tx.finPayment.groupBy({ by: ['recordedById'], where: { schoolId: sid, receivedOn: todayDate, voidRow: null, status: { not: 'REJECTED' } } });
    const todayCashUps = await tx.cashUp.findMany({ where: { schoolId: sid, date: todayDate }, select: { userId: true, status: true } });
    const takerNames = new Map((await tx.user.findMany({ where: { schoolId: sid, id: { in: takers.map((t) => t.recordedById) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const cashUps = takers.map((t) => {
      const c = todayCashUps.find((x) => x.userId === t.recordedById);
      const status: 'NOT_STARTED' | 'SUBMITTED' | 'SIGNED_OFF' = !c || c.status === 'OPEN' ? 'NOT_STARTED' : c.status === 'SIGNED_OFF' ? 'SIGNED_OFF' : 'SUBMITTED';
      return { userId: t.recordedById, name: takerNames.get(t.recordedById) ?? 'Unknown', status };
    });

    const owedBySponsors = await sponsorOwed(tx, sid);
    const newestRate = await tx.exchangeRate.findFirst({ where: { schoolId: sid }, orderBy: { effectiveFrom: 'desc' }, select: { effectiveFrom: true } });
    const zigOn = (await tx.finSettings.findUnique({ where: { schoolId: sid }, select: { staleRateDays: true } }))?.staleRateDays ?? 3;
    const staleRate = !!newestRate && Date.now() - newestRate.effectiveFrom.getTime() > zigOn * DAY;

    return {
      term: { id: term.id, name: term.name, status: term.status, startDate: ymd(term.startDate), endDate: ymd(term.endDate) },
      lastTerm: lastTerm ? { id: lastTerm.id, name: lastTerm.name } : null,
      terms: terms.map((t) => ({ id: t.id, name: t.name })),
      fund: fund ? { id: fund.id, name: fund.name } : null,
      billed, collected,
      collectionRate: Object.fromEntries(CURRENCIES.map((c) => [c, { rate: billed[c] > 0 ? Math.round((collected[c] / billed[c]) * 1000) / 10 : null, lastTermRate: lastRate[c] }])) as Record<Cur, Pct>,
      outstanding: { thisTerm: out, earlier: arrears },
      today: { collected: tot(todayVerified as never), pending: tot(todayPending as never), pendingCount: todayPending.reduce((s, r) => s + r._count._all, 0) },
      owing: { learners: byStudent.size, moreThanOneTerm: Array.from(byStudent.values()).filter((s) => s.owed.size > 1).length },
      weekly,
      byForm: Array.from(forms.entries()).sort((a, b) => a[1].order - b[1].order).map(([form, v]) => ({ form, outstanding: v.outstanding })),
      byMethod: Array.from(methodMap.entries()).map(([method, v]) => ({ method, ...v })).sort((a, b) => b.count - a.count),
      byBucket: Array.from(bucketMap.entries()).map(([bucket, v]) => ({ bucket, ...v })),
      cashUps, sponsorsOwe: owedBySponsors, staleRate,
      waiting: {
        payments: {
          count: pendingAll.reduce((s, r) => s + r._count._all, 0), totals: tot(pendingAll as never),
          oldest: pendingOldest.map((p) => ({ id: p.id, receiptNumber: p.receiptNumber, student: p.student.fullName, receivedOn: ymd(p.receivedOn), currency: p.currency, amountCents: p.amountCents })),
        },
        requestsToApprove: toApprove, requestsToPay: toPay,
      },
    };
  });
}

async function sponsorOwed(tx: Db, schoolId: string): Promise<{ total: Totals; oldestUnpaidTerm: string | null; sponsors: number }> {
  const { sponsorReceivables } = await import('@/lib/finance/sponsors');
  const rows = await sponsorReceivables(tx, schoolId);
  const total = zeroTotals();
  let oldest: { start: string; name: string } | null = null;
  const sponsors = new Set<string>();
  for (const r of rows) {
    if (r.owedCents <= 0) continue;
    total[r.currency] += r.owedCents;
    sponsors.add(r.sponsorId);
    if (!oldest || r.termStart < oldest.start) oldest = { start: r.termStart, name: r.termName };
  }
  return { total, oldestUnpaidTerm: oldest ? oldest.name : null, sponsors: sponsors.size };
}
