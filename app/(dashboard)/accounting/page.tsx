import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { formatUSD, formatZiG, isoWeekKey } from '@/lib/utils';
import { CurrencyToggle } from '@/components/accounting/CurrencyToggle';
import { ExpensePieChart } from '@/components/accounting/ExpensePieChart';
import { CollectionTrendChart } from '@/components/accounting/CollectionTrendChart';
import { WhatsAppRemindersButton } from '@/components/accounting/WhatsAppRemindersButton';
import type { SessionUser } from '@/types';
import type { Currency } from '@prisma/client';

export default async function AccountingDashboard({
  searchParams,
}: {
  searchParams: { currency?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const { schoolId } = user;

  const currency: Currency = searchParams?.currency === 'ZIG' ? 'ZIG' : 'USD';

  // ── Parallel Prisma queries ────────────────────────────────────────────────
  const [
    collectedUSDRaw,
    collectedZiGRaw,
    spentUSDRaw,
    spentZiGRaw,
    expCatRaw,
    pmRaw,
    students,
    recentPayments,
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
        fullName: true,
        parentPhone: true,
        charges: { select: { currency: true, amount: true, issuedAt: true } },
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
  ]);

  // ── Scalar totals ───────────────────────────────────────────────────────────
  const collectedUSD = collectedUSDRaw._sum.amount?.toNumber() ?? 0;
  const collectedZiG = collectedZiGRaw._sum.amount?.toNumber() ?? 0;
  const spentUSD     = spentUSDRaw._sum.amount?.toNumber() ?? 0;
  const spentZiG     = spentZiGRaw._sum.amount?.toNumber() ?? 0;
  const netUSD       = collectedUSD - spentUSD;
  const netZiG       = collectedZiG - spentZiG;

  // ── Per-student: balances + aging + status ──────────────────────────────────
  let outstandingUSD = 0;
  let outstandingZiG = 0;
  let clearedCount   = 0;
  let owingCount     = 0;
  const aging = { a: 0, b: 0, c: 0 }; // 0-30d / 31-60d / 61+d
  const owingStudents: {
    id: string; fullName: string; parentPhone: string; balanceUSD: number; balanceZiG: number
  }[] = [];
  const now = Date.now();

  for (const s of students) {
    const cUSD = s.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter(p => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const cZiG = s.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pZiG = s.payments.filter(p => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);

    const balUSD = Math.max(0, cUSD - pUSD);
    const balZiG = Math.max(0, cZiG - pZiG);
    outstandingUSD += balUSD;
    outstandingZiG += balZiG;

    if (balUSD > 0 || balZiG > 0) {
      owingCount++;
      owingStudents.push({
        id: s.id,
        fullName: s.fullName,
        parentPhone: s.parentPhone,
        balanceUSD: balUSD,
        balanceZiG: balZiG,
      });

      if (balUSD > 0) {
        const usdCharges = s.charges.filter(c => c.currency === 'USD');
        if (usdCharges.length > 0) {
          const oldestMs = Math.min(...usdCharges.map(c => new Date(c.issuedAt).getTime()));
          const days = Math.floor((now - oldestMs) / 86_400_000);
          if (days <= 30) aging.a += balUSD;
          else if (days <= 60) aging.b += balUSD;
          else aging.c += balUSD;
        }
      }
    } else {
      clearedCount++;
    }
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
  // Bridge last actual week onto projected line so the dashed line visually extends from it
  if (weeklyTrend.length > 0) {
    weeklyTrend[weeklyTrend.length - 1].projected = weeklyTrend[weeklyTrend.length - 1].collected;
  }
  const nextWk = isoWeekKey(new Date(Date.now() + 7 * 86_400_000));
  if (!actualWeeks.includes(nextWk)) {
    weeklyTrend.push({ week: nextWk, collected: null, projected: avgCollected });
  }

  const fmt = (n: number) => (currency === 'USD' ? formatUSD(n) : formatZiG(n));

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Accounting Dashboard</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">School-wide financial overview</p>
        </div>
        <CurrencyToggle current={currency} />
      </div>

      {/* ── Ledger cards ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* USD ledger */}
        <div
          className="rounded-xl border border-[#e7e5e4] bg-white p-5"
          style={{ borderLeftColor: '#065f46', borderLeftWidth: '4px' }}
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
            USD Ledger
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Collected', value: formatUSD(collectedUSD), color: '#065f46' },
              { label: 'Spent',     value: formatUSD(spentUSD),     color: '#b91c1c' },
              { label: 'Net',       value: formatUSD(netUSD),       color: netUSD >= 0 ? '#15803d' : '#b91c1c' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-xs text-[#78716c]">{label}</p>
                <p className="mt-1 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[#e7e5e4] pt-3">
            <p className="text-xs text-[#78716c]">
              Outstanding:{' '}
              <span className="font-semibold text-[#292524]">{formatUSD(outstandingUSD)}</span>
            </p>
          </div>
        </div>

        {/* ZiG ledger */}
        <div
          className="rounded-xl border border-[#e7e5e4] bg-white p-5"
          style={{ borderLeftColor: '#f59e0b', borderLeftWidth: '4px' }}
        >
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
            ZiG Ledger
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Collected', value: formatZiG(collectedZiG), color: '#065f46' },
              { label: 'Spent',     value: formatZiG(spentZiG),     color: '#b91c1c' },
              { label: 'Net',       value: formatZiG(netZiG),       color: netZiG >= 0 ? '#15803d' : '#b91c1c' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-xs text-[#78716c]">{label}</p>
                <p className="mt-1 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[#e7e5e4] pt-3">
            <p className="text-xs text-[#78716c]">
              Outstanding:{' '}
              <span className="font-semibold text-[#292524]">{formatZiG(outstandingZiG)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Charts ────────────────────────────────────────────────────────────── */}
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

      {/* ── Fee aging ─────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[#292524]">
          Fee Aging{' '}
          <span className="font-normal text-[#78716c]">(USD outstanding by charge age)</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              { label: '0–30 days',  amount: aging.a, color: '#15803d' },
              { label: '31–60 days', amount: aging.b, color: '#d97706' },
              { label: '61+ days',   amount: aging.c, color: '#b91c1c' },
            ] as const
          ).map(({ label, amount, color }) => (
            <div key={label} className="rounded-xl border border-[#e7e5e4] bg-white p-4">
              <p className="text-xs font-medium text-[#78716c]">{label}</p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color }}>
                {formatUSD(amount)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Student status + WhatsApp reminders ──────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-xl border border-[#e7e5e4] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Cleared</p>
            <p className="mt-1 text-4xl font-bold text-[#15803d]">{clearedCount}</p>
            <p className="text-xs text-[#78716c]">students</p>
          </div>
          <div className="h-12 w-px bg-[#e7e5e4]" />
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Owing</p>
            <p className="mt-1 text-4xl font-bold text-[#b91c1c]">{owingCount}</p>
            <p className="text-xs text-[#78716c]">students</p>
          </div>
        </div>
        <WhatsAppRemindersButton owingStudents={owingStudents} currency={currency} />
      </div>

      {/* ── Quick access ──────────────────────────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
          Quick Access
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { href: '/accounting/students', label: 'Students & Fees' },
            { href: '/accounting/payments', label: 'Payments'        },
            { href: '/accounting/expenses', label: 'Expenses'        },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="transition-shadow hover:shadow-md">
                <p className="font-medium text-[#292524]">{item.label}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
