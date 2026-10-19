import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import {
  ChartRow,
  DashboardHeader,
  Gauge,
  Panel,
  PersonRow,
  PillBars,
  PrimaryLink,
  SecondaryLink,
  SmallLink,
  StatRow,
  TodoList,
  type TodoItem,
} from '@/components/dashboard/parts';
import { formatUSD, formatZiG, getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

const METHOD_LABEL = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ');

export default async function HeadDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const { schoolId } = user;

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { currentTerm: true } });
  const term = school?.currentTerm ?? '';

  const [pendingPayments, pendingCount, marksForTerm, publishedForTerm, students] = await Promise.all([
    prisma.payment.findMany({
      where: { schoolId, status: 'PENDING' },
      orderBy: { recordedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        student: { select: { fullName: true } },
      },
    }),
    prisma.payment.count({ where: { schoolId, status: 'PENDING' } }),
    prisma.mark.findMany({ where: { schoolId, term }, select: { student: { select: { grade: true } } } }),
    prisma.termResult.findMany({ where: { schoolId, term, published: true }, select: { student: { select: { grade: true } } } }),
    prisma.student.findMany({
      where: { schoolId, active: true },
      select: {
        id: true,
        grade: true,
        charges: { select: { currency: true, amount: true, issuedAt: true } },
        payments: { where: { status: 'VERIFIED' }, select: { currency: true, amount: true } },
      },
    }),
  ]);

  const gradesWithMarks = new Set(marksForTerm.map((m) => m.student.grade));
  const gradesPublished = new Set(publishedForTerm.map((r) => r.student.grade));
  const unpublishedGrades = Array.from(gradesWithMarks).filter((g) => !gradesPublished.has(g));
  const publishedPercent = gradesWithMarks.size
    ? Math.round(((gradesWithMarks.size - unpublishedGrades.length) / gradesWithMarks.size) * 100)
    : 0;

  let overdueCount = 0;
  const owingByGrade = new Map<string, number>();
  for (const s of students) {
    const sum = (rows: { currency: string; amount: { toNumber(): number } }[], cur: string) =>
      rows.filter((r) => r.currency === cur).reduce((n, r) => n + r.amount.toNumber(), 0);
    const balUSD = Math.max(0, sum(s.charges, 'USD') - sum(s.payments, 'USD'));
    const balZiG = Math.max(0, sum(s.charges, 'ZIG') - sum(s.payments, 'ZIG'));
    if (balUSD <= 0 && balZiG <= 0) continue;
    if (s.charges.length === 0) continue;

    owingByGrade.set(s.grade, (owingByGrade.get(s.grade) ?? 0) + 1);

    const oldestMs = Math.min(...s.charges.map((c) => new Date(c.issuedAt).getTime()));
    if (getDaysOverdue(new Date(oldestMs)) >= 60) overdueCount++;
  }

  const bars = Array.from(owingByGrade.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .slice(0, 8)
    .map(([grade, count]) => ({ id: grade, name: grade, count }));

  const todo = [
    pendingCount > 0 && { text: `${pendingCount} payment${pendingCount === 1 ? '' : 's'} waiting to be verified`, href: '/head/payments', tone: 'bg-gold' },
    unpublishedGrades.length > 0 && { text: `${unpublishedGrades.length} grade${unpublishedGrades.length === 1 ? '' : 's'} with unpublished results`, href: '/head/results', tone: 'bg-primary' },
    overdueCount > 0 && { text: `${overdueCount} student${overdueCount === 1 ? '' : 's'} more than 60 days overdue`, href: '/head/fees', tone: 'bg-danger' },
  ].filter(Boolean) as TodoItem[];

  return (
    <div className="flex flex-col gap-4 pb-2">
      <DashboardHeader
        subtitle={`${term ? `${term}: ` : ''}what needs your sign-off, what is owed, and which results are ready to publish.`}
        actions={
          <>
            <PrimaryLink href="/head/payments">Verify payments</PrimaryLink>
            <SecondaryLink href="/head/results">Publish results</SecondaryLink>
          </>
        }
      />

      <StatRow>
        <StatCard hero label="Payments to verify" value={pendingCount} note={pendingCount ? 'Waiting for your sign-off' : 'Nothing waiting'} href="/head/payments" />
        <StatCard label="Grades to publish" value={unpublishedGrades.length} note={unpublishedGrades.length ? 'Marks entered, not published' : 'All results published'} href="/head/results" />
        <StatCard label="Overdue 60+ days" value={overdueCount} tone={overdueCount ? 'danger' : 'default'} note={overdueCount ? 'Students with fees outstanding' : 'No long overdue fees'} href="/head/fees" />
        <StatCard label="Students enrolled" value={students.length} note="Active this term" href="/head/reports" />
      </StatRow>

      <ChartRow>
        <Panel title="Students owing fees per grade" className="lg:col-span-2 xl:col-span-1">
          {bars.length === 0 ? (
            <p className="py-10 text-sm text-muted">No outstanding fees. Every student with charges has paid in full.</p>
          ) : (
            <PillBars bars={bars} unit="students owing" />
          )}
          {owingByGrade.size > bars.length && (
            <Link href="/head/fees" className="mt-3 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
              Show all {owingByGrade.size} grades
            </Link>
          )}
        </Panel>

        <Panel title="Results published">
          {gradesWithMarks.size === 0 ? (
            <p className="py-10 text-sm text-muted">No marks entered yet{term ? ` for ${term}` : ''}.</p>
          ) : (
            <Gauge
              percent={publishedPercent}
              caption={`of grades with marks are published${term ? ` for ${term}` : ''}`}
              filledLabel="Published"
              emptyLabel="Not yet"
            />
          )}
        </Panel>

        <Panel title="Still to do">
          <TodoList items={todo} emptyText="Nothing outstanding. All payments are verified, results are published and no fees are long overdue." />
        </Panel>
      </ChartRow>

      <Panel title="Payments waiting to be verified" action={<SmallLink href="/head/payments">Review payments</SmallLink>}>
        {pendingPayments.length === 0 ? (
          <p className="text-sm text-muted">No payments waiting. New payments recorded by the bursar will show here.</p>
        ) : (
          <ul className="grid gap-x-8 md:grid-cols-2">
            {pendingPayments.map((p) => (
              <PersonRow
                key={p.id}
                name={p.student.fullName}
                detail={`${p.currency === 'USD' ? formatUSD(p.amount) : formatZiG(p.amount)}, ${METHOD_LABEL(p.method)}`}
                badge={<Badge variant="warning" label="Pending" />}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
