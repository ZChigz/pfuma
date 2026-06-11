import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatUSD, formatZiG, formatDate, isoWeekKey } from '@/lib/utils';
import { CurrencyToggle } from '@/components/accounting/CurrencyToggle';
import { ExpensePieChart } from '@/components/accounting/ExpensePieChart';
import { CollectionTrendChart } from '@/components/accounting/CollectionTrendChart';
import { RequestReviewModal } from '@/components/accounting/RequestReviewModal';
import { REQUEST_INCLUDE, REQUEST_TYPE_LABELS, serializeExpenseRequest } from '@/lib/expense-requests';
import { Badge } from '@/components/ui/Badge';
import type { SessionUser } from '@/types';
import type { Currency } from '@prisma/client';

export default async function DirectorDashboard({
  searchParams,
}: {
  searchParams: { currency?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'DIRECTOR') redirect('/');

  const { schoolId } = user;
  const currency: Currency = searchParams?.currency === 'ZIG' ? 'ZIG' : 'USD';

  const [
    collectedUSDRaw,
    collectedZiGRaw,
    spentUSDRaw,
    spentZiGRaw,
    expCatRaw,
    pmRaw,
    students,
    recentPayments,
    pendingApprovalsRaw,
  ] = await Promise.all([
    prisma.payment.aggregate({ where: { schoolId, status: 'VERIFIED', currency: 'USD' }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { schoolId, status: 'VERIFIED', currency: 'ZIG' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { schoolId, status: 'ACTIVE', currency: 'USD' }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { schoolId, status: 'ACTIVE', currency: 'ZIG' }, _sum: { amount: true } }),
    prisma.expense.groupBy({
      by: ['category'],
      where: { schoolId, status: 'ACTIVE', currency },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { schoolId, status: 'VERIFIED', currency },
      _sum: { amount: true },
      _count: { id: true },
    }),
    prisma.student.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        charges: { select: { currency: true, amount: true } },
        payments: {
          where: { status: 'VERIFIED' },
          select: { currency: true, amount: true },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        schoolId,
        status: 'VERIFIED',
        currency,
        recordedAt: { gte: new Date(Date.now() - 56 * 86_400_000) },
      },
      select: { amount: true, recordedAt: true },
    }),
    prisma.expenseRequest.findMany({
      where: { schoolId, status: 'PENDING' },
      include: REQUEST_INCLUDE,
      orderBy: { requestedAt: 'asc' },
    }),
  ]);

  // ── Scalar totals ───────────────────────────────────────────────────────────
  const collectedUSD = collectedUSDRaw._sum.amount?.toNumber() ?? 0;
  const collectedZiG = collectedZiGRaw._sum.amount?.toNumber() ?? 0;
  const spentUSD     = spentUSDRaw._sum.amount?.toNumber() ?? 0;
  const spentZiG     = spentZiGRaw._sum.amount?.toNumber() ?? 0;
  const netUSD       = collectedUSD - spentUSD;
  const netZiG       = collectedZiG - spentZiG;

  // ── Per-student: balances + cleared/owing ───────────────────────────────────
  let outstandingUSD = 0;
  let outstandingZiG = 0;
  let clearedCount   = 0;
  let owingCount     = 0;

  for (const s of students) {
    const cUSD = s.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter(p => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const cZiG = s.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pZiG = s.payments.filter(p => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);

    const balUSD = Math.max(0, cUSD - pUSD);
    const balZiG = Math.max(0, cZiG - pZiG);
    outstandingUSD += balUSD;
    outstandingZiG += balZiG;

    if (balUSD > 0 || balZiG > 0) owingCount++;
    else clearedCount++;
  }

  // ── Expense pie slices ──────────────────────────────────────────────────────
  const expensesByCategory = expCatRaw.map(e => ({
    category: e.category,
    total: e._sum.amount?.toNumber() ?? 0,
  }));

  // ── Payment method cards ────────────────────────────────────────────────────
  const ALL_METHODS = ['CASH', 'ECOCASH', 'SWIPE', 'ZIPIT'] as const;
  const methodMap = Object.fromEntries(
    pmRaw.map(p => [p.method, { total: p._sum.amount?.toNumber() ?? 0, count: p._count.id }]),
  );
  const paymentsByMethod = ALL_METHODS.map(m => ({
    method: m,
    total: methodMap[m]?.total ?? 0,
    count: methodMap[m]?.count ?? 0,
  }));

  // ── Weekly trend (8 ISO weeks actual + 1 projected) ─────────────────────────
  const weekMap = new Map<string, number>();
  for (const p of recentPayments) {
    const wk = isoWeekKey(p.recordedAt);
    weekMap.set(wk, (weekMap.get(wk) ?? 0) + p.amount.toNumber());
  }

  const actualWeeks: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const wk = isoWeekKey(new Date(Date.now() - i * 7 * 86_400_000));
    if (!actualWeeks.includes(wk)) actualWeeks.push(wk);
  }

  const lastThree = actualWeeks.slice(-3).map(wk => weekMap.get(wk) ?? 0);
  const avgCollected = lastThree.length > 0
    ? lastThree.reduce((s, v) => s + v, 0) / lastThree.length
    : 0;

  type TrendPoint = { week: string; collected: number | null; projected: number | null };
  const weeklyTrend: TrendPoint[] = actualWeeks.map(wk => ({
    week: wk,
    collected: weekMap.get(wk) ?? 0,
    projected: null,
  }));
  if (weeklyTrend.length > 0) {
    weeklyTrend[weeklyTrend.length - 1].projected = weeklyTrend[weeklyTrend.length - 1].collected;
  }
  const nextWk = isoWeekKey(new Date(Date.now() + 7 * 86_400_000));
  if (!actualWeeks.includes(nextWk)) {
    weeklyTrend.push({ week: nextWk, collected: null, projected: avgCollected });
  }

  // ── Stale pending approvals (governance alert: >2 days awaiting HEAD) ───────
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const pendingApprovals = pendingApprovalsRaw
    .filter((r) => r.requestedAt <= twoDaysAgo)
    .map(serializeExpenseRequest);

  const fmt = (n: number) => (currency === 'USD' ? formatUSD(n) : formatZiG(n));

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Profitability</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">School-wide financial position — read only</p>
        </div>
        <Link
          href="/director/voids"
          className="inline-flex min-h-[44px] items-center rounded-md bg-[#065f46] px-4 text-sm font-medium text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
        >
          Void an entry
        </Link>
      </div>

      {/* ── Net position cards ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[#e7e5e4] bg-[#065f46] p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">USD Net Position</p>
          <p className="mt-2 text-4xl font-bold tabular-nums">{formatUSD(netUSD)}</p>
          <p className="mt-2 text-xs text-emerald-200">
            Collected {formatUSD(collectedUSD)} · Spent {formatUSD(spentUSD)}
          </p>
        </div>
        <div className="rounded-xl border border-[#f59e0b] bg-amber-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">ZiG Net Position</p>
          <p className="mt-2 text-4xl font-bold tabular-nums text-amber-900">{formatZiG(netZiG)}</p>
          <p className="mt-2 text-xs text-amber-700">
            Collected {formatZiG(collectedZiG)} · Spent {formatZiG(spentZiG)}
          </p>
        </div>
      </div>

      {/* ── Collected vs Outstanding vs Spent per currency ───────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className="rounded-xl border border-[#e7e5e4] bg-white p-5"
          style={{ borderLeftColor: '#065f46', borderLeftWidth: '4px' }}
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#78716c]">USD</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Collected',   value: formatUSD(collectedUSD), color: '#065f46' },
              { label: 'Outstanding', value: formatUSD(outstandingUSD), color: '#b91c1c' },
              { label: 'Spent',       value: formatUSD(spentUSD),     color: '#78716c' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-xs text-[#78716c]">{label}</p>
                <p className="mt-1 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-xl border border-[#e7e5e4] bg-white p-5"
          style={{ borderLeftColor: '#f59e0b', borderLeftWidth: '4px' }}
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#78716c]">ZiG</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Collected',   value: formatZiG(collectedZiG), color: '#065f46' },
              { label: 'Outstanding', value: formatZiG(outstandingZiG), color: '#b91c1c' },
              { label: 'Spent',       value: formatZiG(spentZiG),     color: '#78716c' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-xs text-[#78716c]">{label}</p>
                <p className="mt-1 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Charts ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end">
        <CurrencyToggle current={currency} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-[#292524]">
            Expenses by Category{' '}
            <span className="font-normal text-[#78716c]">({currency})</span>
          </h2>
          <ExpensePieChart data={expensesByCategory} currency={currency} />
        </div>
        <div className="rounded-xl border border-[#e7e5e4] bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-[#292524]">
            Weekly Collection Trend{' '}
            <span className="font-normal text-[#78716c]">({currency})</span>
          </h2>
          <CollectionTrendChart data={weeklyTrend} currency={currency} />
        </div>
      </div>

      {/* ── Payment methods ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[#292524]">
          Payment Methods{' '}
          <span className="font-normal text-[#78716c]">({currency}, verified only)</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {paymentsByMethod.map(({ method, total, count }) => (
            <div key={method} className="rounded-xl border border-[#e7e5e4] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{method}</p>
              <p className="mt-1.5 text-xl font-bold tabular-nums text-[#292524]">{fmt(total)}</p>
              <p className="mt-0.5 text-xs text-[#78716c]">
                {count}&nbsp;{count === 1 ? 'payment' : 'payments'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Student status ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#e7e5e4] bg-white p-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Students cleared this term</p>
          <p className="mt-1 text-4xl font-bold text-[#15803d]">{clearedCount}</p>
        </div>
        <div className="hidden h-12 w-px bg-[#e7e5e4] sm:block" />
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Students owing</p>
          <p className="mt-1 text-4xl font-bold text-[#b91c1c]">{owingCount}</p>
        </div>
        <div className="hidden h-12 w-px bg-[#e7e5e4] sm:block" />
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Outstanding fees</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[#292524]">{formatUSD(outstandingUSD)}</p>
          <p className="text-xs text-[#78716c]">{formatZiG(outstandingZiG)}</p>
        </div>
      </div>

      {/* ── Pending approvals (governance alert) ─────────────────────────────── */}
      {pendingApprovals.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[#292524]">Pending approvals</h2>
            <Badge label={String(pendingApprovals.length)} variant="danger" />
          </div>
          <p className="mb-3 text-sm text-[#78716c]">
            These requests have been awaiting Head approval for more than 2 days. You can approve or reject them directly.
          </p>
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Request #', 'Title', 'Department', 'Requested By', 'Amount', 'Date', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {pendingApprovals.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.requestNumber}</td>
                    <td className="px-4 py-3">
                      {r.title}
                      <span className="block text-xs text-[#78716c]">{REQUEST_TYPE_LABELS[r.type]}</span>
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{r.department}</td>
                    <td className="px-4 py-3 text-[#78716c]">{r.requestedBy.fullName}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(r.estimatedTotal) : formatZiG(r.estimatedTotal)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">{formatDate(r.requestedAt)}</td>
                    <td className="px-4 py-3">
                      <RequestReviewModal request={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
