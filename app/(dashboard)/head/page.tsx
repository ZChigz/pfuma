import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { StatCard } from '@/components/ui/StatCard';
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Head&apos;s Office</h1>
        <p className="mt-1 text-sm text-muted">{currentTerm || 'Term not set'} — overview</p>
      </div>

      {/* Summary row */}
      <div className="grid gap-4 sm:grid-cols-3">
        {summaryCards.map((c, i) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            href={c.href}
            hero={i === 0 && c.value > 0}
            tone={c.value === 0 ? 'default' : c.tone === 'red' ? 'danger' : 'warning'}
            note={c.value === 0 ? 'Nothing waiting' : 'Needs your attention'}
          />
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p className="mb-3 text-xs font-medium text-muted">Quick actions</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/head/payments"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            Verify pending payments
          </Link>
          <Link
            href="/head/fees"
            className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-rowhover focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Apply fees to a grade
          </Link>
          <Link
            href="/head/results"
            className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-rowhover focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Publish results
          </Link>
        </div>
      </div>
    </div>
  );
}
