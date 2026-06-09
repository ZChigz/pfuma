import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { isoWeekKey } from '@/lib/utils';
import { type Currency } from '@prisma/client';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const { schoolId } = user;

  const rawCurr = new URL(req.url).searchParams.get('currency');
  const currency: Currency = rawCurr === 'ZIG' ? 'ZIG' : 'USD';

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

  const collectedUSD = collectedUSDRaw._sum.amount?.toNumber() ?? 0;
  const collectedZiG = collectedZiGRaw._sum.amount?.toNumber() ?? 0;
  const spentUSD     = spentUSDRaw._sum.amount?.toNumber() ?? 0;
  const spentZiG     = spentZiGRaw._sum.amount?.toNumber() ?? 0;

  // ── Per-student balances ──────────────────────────────────────────────────
  let outstandingUSD = 0;
  let outstandingZiG = 0;
  let clearedCount = 0;
  let owingCount = 0;
  const aging = { a: 0, b: 0, c: 0 }; // 0-30 / 31-60 / 61+
  const owingStudents: { id: string; fullName: string; parentPhone: string; balanceUSD: number; balanceZiG: number }[] = [];
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
      owingStudents.push({ id: s.id, fullName: s.fullName, parentPhone: s.parentPhone, balanceUSD: balUSD, balanceZiG: balZiG });

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

  // ── Chart data ───────────────────────────────────────────────────────────
  const expensesByCategory = expCatRaw.map(e => ({
    category: e.category,
    total: e._sum.amount?.toNumber() ?? 0,
  }));

  const ALL_METHODS = ['CASH', 'ECOCASH', 'SWIPE', 'ZIPIT'] as const;
  const methodMap = Object.fromEntries(
    pmRaw.map(p => [p.method, { total: p._sum.amount?.toNumber() ?? 0, count: p._count.id }]),
  );
  const paymentsByMethod = ALL_METHODS.map(m => ({
    method: m,
    total: methodMap[m]?.total ?? 0,
    count: methodMap[m]?.count ?? 0,
  }));

  // Weekly trend — last 8 ISO weeks + 1 projected
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
  const avgCollected = lastThree.length ? lastThree.reduce((s, v) => s + v, 0) / lastThree.length : 0;

  type TrendPoint = { week: string; collected: number | null; projected: number | null };
  const weeklyTrend: TrendPoint[] = actualWeeks.map(wk => ({
    week: wk,
    collected: weekMap.get(wk) ?? 0,
    projected: null,
  }));

  const nextWk = isoWeekKey(new Date(Date.now() + 7 * 86_400_000));
  if (weeklyTrend.length > 0) {
    weeklyTrend[weeklyTrend.length - 1].projected = weeklyTrend[weeklyTrend.length - 1].collected;
  }
  if (!actualWeeks.includes(nextWk)) {
    weeklyTrend.push({ week: nextWk, collected: null, projected: avgCollected });
  }

  return apiSuccess({
    collectedUSD,
    collectedZiG,
    spentUSD,
    spentZiG,
    netUSD: collectedUSD - spentUSD,
    netZiG: collectedZiG - spentZiG,
    outstandingUSD,
    outstandingZiG,
    expensesByCategory,
    paymentsByMethod,
    agingBuckets: [
      { label: '0–30 days',  total: aging.a },
      { label: '31–60 days', total: aging.b },
      { label: '61+ days',   total: aging.c },
    ],
    weeklyTrend,
    clearedCount,
    owingCount,
    owingStudents,
    currency,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/accounting/dashboard', _GET as H);
