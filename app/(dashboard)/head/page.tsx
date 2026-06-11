import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

export default async function HeadDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const { schoolId } = user;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { currentTerm: true },
  });
  const currentTerm = school?.currentTerm ?? '';

  const [pendingPaymentsCount, marksForTerm, publishedForTerm, students] = await Promise.all([
    prisma.payment.count({ where: { schoolId, status: 'PENDING' } }),
    prisma.mark.findMany({
      where: { schoolId, term: currentTerm },
      select: { student: { select: { grade: true } } },
    }),
    prisma.termResult.findMany({
      where: { schoolId, term: currentTerm, published: true },
      select: { student: { select: { grade: true } } },
    }),
    prisma.student.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        charges:  { select: { currency: true, amount: true, issuedAt: true } },
        payments: { where: { status: 'VERIFIED' }, select: { currency: true, amount: true } },
      },
    }),
  ]);

  const gradesWithMarks = new Set(marksForTerm.map((m) => m.student.grade));
  const gradesPublished = new Set(publishedForTerm.map((r) => r.student.grade));
  const unpublishedGrades = Array.from(gradesWithMarks).filter((g) => !gradesPublished.has(g));

  let overdueCount = 0;
  for (const s of students) {
    const cUSD = s.charges.filter((c) => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter((p) => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const cZiG = s.charges.filter((c) => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pZiG = s.payments.filter((p) => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);

    const balUSD = Math.max(0, cUSD - pUSD);
    const balZiG = Math.max(0, cZiG - pZiG);
    if (balUSD <= 0 && balZiG <= 0) continue;
    if (s.charges.length === 0) continue;

    const oldestMs = Math.min(...s.charges.map((c) => new Date(c.issuedAt).getTime()));
    if (getDaysOverdue(new Date(oldestMs)) >= 60) overdueCount++;
  }

  const summaryCards = [
    {
      label: 'Pending payments to verify',
      value: pendingPaymentsCount,
      tone: 'amber',
      href: '/head/payments',
    },
    {
      label: 'Grades with unpublished results',
      value: unpublishedGrades.length,
      tone: 'amber',
      href: '/head/results',
    },
    {
      label: 'Students 60+ days overdue',
      value: overdueCount,
      tone: 'red',
      href: '/head/fees',
    },
  ] as const;

  const toneClasses: Record<string, string> = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red:   'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Head&apos;s Office</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">{currentTerm || 'Term not set'} — overview</p>
      </div>

      {/* Summary row */}
      <div className="grid gap-4 sm:grid-cols-3">
        {summaryCards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`rounded-xl border px-5 py-4 transition-shadow hover:shadow-md ${
              c.value > 0 ? toneClasses[c.tone] : 'border-[#e7e5e4] bg-white text-[#292524]'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{c.label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{c.value}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Quick Actions</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/head/payments"
            className="inline-flex min-h-[44px] items-center rounded-md bg-[#065f46] px-4 text-sm font-medium text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
          >
            Verify pending payments
          </Link>
          <Link
            href="/head/fees"
            className="inline-flex min-h-[44px] items-center rounded-md border border-[#e7e5e4] bg-white px-4 text-sm font-medium text-[#292524] transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
          >
            Apply fees to a grade
          </Link>
          <Link
            href="/head/results"
            className="inline-flex min-h-[44px] items-center rounded-md border border-[#e7e5e4] bg-white px-4 text-sm font-medium text-[#292524] transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
          >
            Publish results
          </Link>
        </div>
      </div>
    </div>
  );
}
