import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { StatCard } from '@/components/ui/StatCard';
import { getDaysOverdue } from '@/lib/utils';
import { getOpenTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

const METHOD_LABEL = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function HeadDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'HEAD') redirect('/');

  const { schoolId } = user;

  const openTerm = await getOpenTerm(schoolId, db);
  const currentTerm = openTerm?.name ?? '';

  const [pendingPaymentsCount, unpublishedAssignments, students] = await Promise.all([
    db.payment.count({ where: { schoolId, status: 'PENDING' } }),
    // Classes where marking has started but results are not yet published.
    openTerm
      ? db.subjectAssignment.findMany({
          where: { schoolId, termId: openTerm.id, marksStatus: { in: ['IN_PROGRESS', 'VERIFIED'] } },
          select: { classId: true },
          distinct: ['classId'],
        })
      : [],
    db.student.findMany({
      where: { schoolId, status: 'ACTIVE' },
      select: {
        id: true,
        currentClass: { select: { level: { select: { name: true } } } },
        charges: { select: { currency: true, amount: true, issuedAt: true } },
        payments: { where: { status: 'VERIFIED' }, select: { currency: true, amount: true } },
      },
    }),
  ]);

  const unpublishedClasses = unpublishedAssignments.length;

  let overdueCount = 0;
  const owingByGrade = new Map<string, number>();
  for (const s of students) {
    const sum = (rows: { currency: string; amount: { toNumber(): number } }[], cur: string) =>
      rows.filter((r) => r.currency === cur).reduce((n, r) => n + r.amount.toNumber(), 0);
    const balUSD = Math.max(0, sum(s.charges, 'USD') - sum(s.payments, 'USD'));
    const balZiG = Math.max(0, sum(s.charges, 'ZIG') - sum(s.payments, 'ZIG'));
    if (balUSD <= 0 && balZiG <= 0) continue;
    if (s.charges.length === 0) continue;

    const form = s.currentClass?.level?.name ?? 'No class';
    owingByGrade.set(form, (owingByGrade.get(form) ?? 0) + 1);

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
      label: 'Classes with unpublished results',
      value: unpublishedClasses,
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
            Apply fees to a level
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
