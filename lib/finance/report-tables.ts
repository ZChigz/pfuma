// The ten finance reports as plain tables (title, headers, rows, totals) so one export route can give any of them as a screen table, CSV, Excel or PDF.
// Every report keeps the two currencies on separate rows: nothing is ever added across currencies.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { dayOf, idSchema, isoDateSchema, need, todayInHarare, ymd, type Actor } from '@/lib/finance/common';
import { chargeLines } from '@/lib/finance/balances';
import { arrearsList } from '@/lib/finance/statements';
import { budgetReport } from '@/lib/finance/spending';
import { sponsorReceivables } from '@/lib/finance/sponsors';
import { fundSummary, harareRange } from '@/lib/finance/reports';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { methodBucket, METHOD_LABEL } from '@/lib/finance/methods';

export const REPORT_SLUGS = [
  'cash-book', 'income-by-item-and-fund', 'collection', 'arrears-ageing', 'daily-collections', 'expenditure-vs-budget',
  'income-and-expenditure', 'sponsor-receivables', 'discounts-and-awards', 'voids-and-refunds',
] as const;
export type ReportSlug = (typeof REPORT_SLUGS)[number];

export interface ReportTable { slug: ReportSlug; title: string; subtitle: string; headers: string[]; rows: (string | number)[][]; align: ('left' | 'right')[]; totals?: (string | number)[]; landscape?: boolean }

export const ReportParams = z.object({
  from: isoDateSchema.optional(), to: isoDateSchema.optional(), fundId: idSchema.optional(), currency: z.enum(['USD', 'ZIG']).optional(), termId: idSchema.optional(), classId: idSchema.optional(),
});
type P = z.infer<typeof ReportParams>;

const m = (c: number, cur: Cur) => formatMoney(c, cur);
const L = 'left' as const; const R = 'right' as const;
const monthStart = () => `${todayInHarare().slice(0, 8)}01`;
const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

export const REPORT_TITLES: Record<ReportSlug, string> = {
  'cash-book': 'Cash book', 'income-by-item-and-fund': 'Income by fee item and fund', collection: 'Collection report', 'arrears-ageing': 'Arrears ageing', 'daily-collections': 'Daily collections',
  'expenditure-vs-budget': 'Expenditure against budget', 'income-and-expenditure': 'Income and expenditure per fund', 'sponsor-receivables': 'Sponsor receivables', 'discounts-and-awards': 'Discounts and awards', 'voids-and-refunds': 'Voids and refunds',
};

export async function runReport(user: Actor, slug: ReportSlug, raw: unknown): Promise<ReportTable> {
  need(user, 'finance.reports.view');
  const p = ReportParams.parse(raw ?? {});
  const from = p.from ?? monthStart(); const to = p.to ?? todayInHarare();
  if (from > to) throw new ServiceError('The start date is after the end date', 422);
  const title = REPORT_TITLES[slug];
  const period = `${from} to ${to}`;
  const db = getScopedDb(user.schoolId, user.id);
  const fundName = async (tx: Parameters<Parameters<typeof db.$tx>[0]>[0]) => new Map((await tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } })).map((f) => [f.id, f.name]));

  switch (slug) {
    case 'cash-book': {
      return db.$tx(async (tx) => {
        const range = harareRange(from, to);
        const fn = await fundName(tx);
        const fundF = p.fundId ? { fundId: p.fundId } : {}; const curF = p.currency ? { currency: p.currency } : {};
        const [pays, exps, refs] = await Promise.all([
          tx.finPayment.findMany({ where: { schoolId: user.schoolId, status: 'VERIFIED', voidRow: null, receivedOn: { gte: dayOf(from), lte: dayOf(to) }, ...fundF, ...curF }, include: { student: { select: { fullName: true } } } }),
          tx.finExpense.findMany({ where: { schoolId: user.schoolId, voidRow: null, paidOn: { gte: dayOf(from), lte: dayOf(to) }, ...fundF, ...curF } }),
          tx.finRefund.findMany({ where: { schoolId: user.schoolId, status: 'PAID', paidAt: range, payment: { voidRow: null, ...fundF, ...curF } }, include: { payment: { select: { currency: true, fundId: true, student: { select: { fullName: true } } } } } }),
        ]);
        type E = { date: string; currency: Cur; ref: string; text: string; fund: string; method: string; inC: number; outC: number };
        const e: E[] = [
          ...pays.map((x) => ({ date: ymd(x.receivedOn), currency: x.currency as Cur, ref: x.receiptNumber ?? x.ackNumber, text: `Fees: ${x.student.fullName}`, fund: fn.get(x.fundId ?? '') ?? 'Any fund', method: METHOD_LABEL[x.method as keyof typeof METHOD_LABEL] ?? x.method, inC: x.amountCents, outC: 0 })),
          ...exps.map((x) => ({ date: ymd(x.paidOn), currency: x.currency as Cur, ref: x.reference ?? '', text: x.description, fund: fn.get(x.fundId) ?? '', method: METHOD_LABEL[x.method as keyof typeof METHOD_LABEL] ?? x.method, inC: 0, outC: x.amountCents })),
          ...refs.map((x) => ({ date: ymd(x.paidAt ?? x.requestedAt), currency: x.payment.currency as Cur, ref: x.reference ?? '', text: `Refund: ${x.payment.student.fullName}`, fund: fn.get(x.payment.fundId ?? '') ?? 'Any fund', method: x.method ? (METHOD_LABEL[x.method as keyof typeof METHOD_LABEL] ?? x.method) : '', inC: 0, outC: x.amountCents })),
        ].sort((a, b) => a.currency.localeCompare(b.currency) || a.date.localeCompare(b.date));
        const bal: Record<Cur, number> = { USD: 0, ZIG: 0 };
        const rows = e.map((x) => { bal[x.currency] += x.inC - x.outC; return [x.date, x.currency, x.ref, x.text, x.fund, x.method, x.inC ? m(x.inC, x.currency) : '', x.outC ? m(x.outC, x.currency) : '', m(bal[x.currency], x.currency)]; });
        const totals = (['USD', 'ZIG'] as Cur[]).filter((c) => e.some((x) => x.currency === c)).map((c) => `${c}: in ${m(sumBy(e.filter((x) => x.currency === c), (x) => x.inC), c)}, out ${m(sumBy(e.filter((x) => x.currency === c), (x) => x.outC), c)}`).join('   ');
        return { slug, title, subtitle: `${period}. Movement in the period, each currency on its own. ${totals}`, headers: ['Date', 'Cur', 'Reference', 'Details', 'Fund', 'Method', 'Money in', 'Money out', 'Balance'], rows, align: [L, L, L, L, L, L, R, R, R], landscape: true };
      });
    }
    case 'income-by-item-and-fund': {
      return db.$tx(async (tx) => {
        const al = await tx.finPaymentAllocation.findMany({
          where: { schoolId: user.schoolId, payment: { status: 'VERIFIED', voidRow: null, receivedOn: { gte: dayOf(from), lte: dayOf(to) } }, charge: { ...(p.fundId ? { fundId: p.fundId } : {}), ...(p.currency ? { currency: p.currency } : {}) } },
          select: { amountCents: true, charge: { select: { description: true, fundId: true, currency: true } } },
        });
        const fn = await fundName(tx);
        const map = new Map<string, { fund: string; item: string; cur: Cur; cents: number; n: number }>();
        for (const a of al) {
          const k = `${a.charge.fundId}|${a.charge.description}|${a.charge.currency}`;
          const r = map.get(k) ?? { fund: fn.get(a.charge.fundId) ?? '', item: a.charge.description, cur: a.charge.currency as Cur, cents: 0, n: 0 };
          r.cents += a.amountCents; r.n++; map.set(k, r);
        }
        const list = Array.from(map.values()).sort((a, b) => a.fund.localeCompare(b.fund) || a.item.localeCompare(b.item) || a.cur.localeCompare(b.cur));
        return { slug, title, subtitle: period, headers: ['Fund', 'Fee item', 'Currency', 'Allocations', 'Income'], rows: list.map((r) => [r.fund, r.item, r.cur, r.n, m(r.cents, r.cur)]), align: [L, L, L, R, R] };
      });
    }
    case 'collection': {
      return db.$tx(async (tx) => {
        const term = p.termId ? await tx.academicTerm.findFirst({ where: { id: p.termId, schoolId: user.schoolId } }) : await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' } });
        if (!term) throw new ServiceError('Choose a term', 422);
        const lines = await chargeLines(tx, user.schoolId, { termId: term.id, fundId: p.fundId, currency: p.currency });
        const studs = await tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: Array.from(new Set(lines.map((l) => l.studentId))) } }, select: { id: true, currentClass: { select: { id: true, name: true } } } });
        const cls = new Map(studs.map((s) => [s.id, s.currentClass]));
        const map = new Map<string, { cls: string; cur: Cur; billed: number; paid: number; out: number }>();
        for (const l of lines) {
          const c = cls.get(l.studentId);
          if (p.classId && c?.id !== p.classId) continue;
          const k = `${c?.name ?? 'No class'}|${l.currency}`;
          const r = map.get(k) ?? { cls: c?.name ?? 'No class', cur: l.currency, billed: 0, paid: 0, out: 0 };
          r.billed += l.charged - l.adjusted; r.paid += l.paid - l.refunded; r.out += l.outstanding; map.set(k, r);
        }
        const list = Array.from(map.values()).sort((a, b) => a.cls.localeCompare(b.cls) || a.cur.localeCompare(b.cur));
        return { slug, title, subtitle: term.name, headers: ['Class', 'Currency', 'Billed', 'Collected', 'Outstanding', 'Collected %'], rows: list.map((r) => [r.cls, r.cur, m(r.billed, r.cur), m(r.paid, r.cur), m(r.out, r.cur), r.billed > 0 ? `${Math.round((r.paid / r.billed) * 100)}%` : '']), align: [L, L, R, R, R, R] };
      });
    }
    case 'arrears-ageing': {
      const a = await arrearsList(user, { currency: p.currency, classId: p.classId, termId: p.termId, fundId: p.fundId });
      const rows: (string | number)[][] = [];
      for (const r of a.rows) for (const c of ['USD', 'ZIG'] as Cur[]) {
        if (r.owed[c] <= 0) continue;
        const b = r.buckets[c];
        rows.push([r.fullName, r.className ?? '', r.guardian ?? '', r.phone ?? '', c, m(b.CURRENT, c), m(b.D30, c), m(b.D60, c), m(b.D90, c), m(b.D90P, c), m(r.owed[c], c), r.lastPayment ? `${r.lastPayment.date}` : '', r.plan === 'ON_PLAN' ? 'On plan' : r.plan === 'PLAN_MISSED' ? 'Plan missed' : '']);
      }
      return { slug, title, subtitle: `As at ${todayInHarare()}`, headers: ['Learner', 'Class', 'Guardian', 'Phone', 'Cur', 'Current', '1–30', '31–60', '61–90', '90+', 'Total owed', 'Last payment', 'Plan'], rows, align: [L, L, L, L, L, R, R, R, R, R, R, L, L], landscape: true };
    }
    case 'daily-collections': {
      return db.$tx(async (tx) => {
        const pays = await tx.finPayment.findMany({ where: { schoolId: user.schoolId, status: 'VERIFIED', voidRow: null, receivedOn: { gte: dayOf(from), lte: dayOf(to) }, ...(p.fundId ? { fundId: p.fundId } : {}), ...(p.currency ? { currency: p.currency } : {}) }, select: { receivedOn: true, currency: true, method: true, amountCents: true } });
        const buckets = ['Cash', 'EcoCash', 'Bank', 'Paynow', 'Others'] as const;
        const map = new Map<string, { date: string; cur: Cur; by: Record<string, number>; total: number }>();
        for (const x of pays) {
          const k = `${ymd(x.receivedOn)}|${x.currency}`;
          const r = map.get(k) ?? { date: ymd(x.receivedOn), cur: x.currency as Cur, by: {}, total: 0 };
          const b = methodBucket(x.method); r.by[b] = (r.by[b] ?? 0) + x.amountCents; r.total += x.amountCents; map.set(k, r);
        }
        const list = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur));
        return { slug, title, subtitle: period, headers: ['Date', 'Currency', ...buckets, 'Total'], rows: list.map((r) => [r.date, r.cur, ...buckets.map((b) => (r.by[b] ? m(r.by[b]!, r.cur) : '')), m(r.total, r.cur)]), align: [L, L, R, R, R, R, R, R] };
      });
    }
    case 'expenditure-vs-budget': {
      const b = await budgetReport(user, p.termId);
      const rows = b.rows.filter((r) => (!p.fundId || r.fundId === p.fundId) && (!p.currency || r.currency === p.currency));
      return { slug, title, subtitle: b.term.name, headers: ['Fund', 'Category', 'Currency', 'Budget', 'Spent', 'Remaining', 'Used %'], rows: rows.map((r) => [r.fundName, r.category, r.currency, m(r.budgetCents, r.currency), m(r.spentCents, r.currency), m(r.remainingCents, r.currency), r.budgetCents > 0 ? `${Math.round((r.spentCents / r.budgetCents) * 100)}%` : 'No budget']), align: [L, L, L, R, R, R, R] };
    }
    case 'income-and-expenditure': {
      const f = await fundSummary(user, { from, to, fundId: p.fundId });
      const rows = f.rows.filter((r) => !p.currency || r.currency === p.currency);
      return { slug, title, subtitle: period, headers: ['Fund', 'Currency', 'Billed', 'Collected', 'Refunded', 'Spent', 'Net', 'Outstanding'], rows: rows.map((r) => [r.fundName, r.currency, m(r.billed, r.currency), m(r.collected, r.currency), m(r.refunded, r.currency), m(r.spent, r.currency), m(r.net, r.currency), m(r.outstanding, r.currency)]), align: [L, L, R, R, R, R, R, R] };
    }
    case 'sponsor-receivables': {
      return db.$tx(async (tx) => {
        const rows = (await sponsorReceivables(tx, user.schoolId)).filter((r) => !p.currency || r.currency === p.currency);
        return { slug, title, subtitle: `As at ${todayInHarare()}`, headers: ['Sponsor', 'Term', 'Currency', 'Claimed', 'Paid', 'Owed'], rows: rows.map((r) => [r.sponsorName, r.termName, r.currency, m(r.claimedCents, r.currency), m(r.paidCents, r.currency), m(r.owedCents, r.currency)]), align: [L, L, L, R, R, R] };
      });
    }
    case 'discounts-and-awards': {
      return db.$tx(async (tx) => {
        const rows = await tx.finAdjustment.findMany({
          where: { schoolId: user.schoolId, status: 'APPROVED', decidedAt: harareRange(from, to), charge: { voidRow: null, ...(p.fundId ? { fundId: p.fundId } : {}), ...(p.currency ? { currency: p.currency } : {}) } },
          include: { charge: { select: { description: true, currency: true, fundId: true, student: { select: { fullName: true } } } } }, orderBy: { decidedAt: 'asc' }, take: 5000,
        });
        const fn = await fundName(tx);
        return { slug, title, subtitle: period, headers: ['Date', 'Learner', 'Kind', 'Fee item', 'Fund', 'Currency', 'Amount', 'Reason'], rows: rows.map((r) => [ymd(r.decidedAt ?? r.createdAt), r.charge.student.fullName, r.kind.replace(/_/g, ' ').toLowerCase(), r.charge.description, fn.get(r.charge.fundId) ?? '', r.charge.currency, m(r.amountCents, r.charge.currency as Cur), r.reason]), align: [L, L, L, L, L, L, R, L], landscape: true };
      });
    }
    case 'voids-and-refunds': {
      return db.$tx(async (tx) => {
        const range = harareRange(from, to);
        const [voids, refunds] = await Promise.all([
          tx.finVoid.findMany({ where: { schoolId: user.schoolId, voidedAt: range }, include: { payment: { select: { currency: true, amountCents: true, receiptNumber: true, ackNumber: true, student: { select: { fullName: true } } } }, expense: { select: { currency: true, amountCents: true, description: true } }, charge: { select: { currency: true, amountCents: true, description: true, student: { select: { fullName: true } } } } }, orderBy: { voidedAt: 'asc' }, take: 3000 }),
          tx.finRefund.findMany({ where: { schoolId: user.schoolId, status: 'PAID', paidAt: range }, include: { payment: { select: { currency: true, receiptNumber: true, ackNumber: true, student: { select: { fullName: true } } } } }, orderBy: { paidAt: 'asc' }, take: 3000 }),
        ]);
        const rows: (string | number)[][] = [];
        for (const v of voids) {
          if (v.payment) rows.push([ymd(v.voidedAt), 'Voided payment', v.payment.receiptNumber ?? v.payment.ackNumber, v.payment.student.fullName, v.payment.currency, m(v.payment.amountCents, v.payment.currency as Cur), v.reason]);
          else if (v.expense) rows.push([ymd(v.voidedAt), 'Voided expense', '', v.expense.description, v.expense.currency, m(v.expense.amountCents, v.expense.currency as Cur), v.reason]);
          else if (v.charge) rows.push([ymd(v.voidedAt), 'Voided charge', '', `${v.charge.student.fullName}: ${v.charge.description}`, v.charge.currency, m(v.charge.amountCents, v.charge.currency as Cur), v.reason]);
        }
        for (const r of refunds) rows.push([ymd(r.paidAt!), 'Refund paid', r.payment.receiptNumber ?? r.payment.ackNumber, r.payment.student.fullName, r.payment.currency, m(r.amountCents, r.payment.currency as Cur), r.reason]);
        rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
        return { slug, title, subtitle: period, headers: ['Date', 'What', 'Receipt', 'Who / what', 'Currency', 'Amount', 'Reason'], rows, align: [L, L, L, L, L, R, L], landscape: true };
      });
    }
  }
}
