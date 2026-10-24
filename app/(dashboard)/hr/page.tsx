import Link from 'next/link';
import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getScopedDb } from '@/lib/scoped-db';
import { todayInHarare, toDay } from '@/lib/hr/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Section } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'HR & Staff · Pfuma' };

export default async function HrHome() {
  const { user, can } = await getAccess();
  if (!can('hr.directory.view') && !can('hr.self.details')) return <AccessDenied />;
  const today = todayInHarare();
  const stats = can('hr.directory.view')
    ? await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
        const [staff, gov, away, pendingLeave, ending, posts] = await Promise.all([
          tx.employee.count({ where: { schoolId: user.schoolId, status: { notIn: ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] } } }),
          tx.employee.count({ where: { schoolId: user.schoolId, employer: 'GOVERNMENT', status: { notIn: ['RESIGNED', 'RETIRED', 'DISMISSED', 'DECEASED'] } } }),
          tx.leaveRequest.count({ where: { schoolId: user.schoolId, status: 'APPROVED', startDate: { lte: toDay(today) }, endDate: { gte: toDay(today) } } }),
          can('hr.leave.approve') ? tx.leaveRequest.count({ where: { schoolId: user.schoolId, status: 'PENDING' } }) : Promise.resolve(null),
          can('hr.contracts.manage') ? tx.contract.count({ where: { schoolId: user.schoolId, status: 'ACTIVE', endDate: { gte: toDay(today), lte: toDay(new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)) } } }) : Promise.resolve(null),
          can('hr.posts.approve') ? tx.post.count({ where: { schoolId: user.schoolId, status: 'PENDING' } }) : Promise.resolve(null),
        ]);
        return { staff, gov, away, pendingLeave, ending, posts };
      })
    : null;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="HR & Staff" description="Everyone who works at the school, whoever pays them." />
      <HrNav can={can} current="/hr" />
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Staff" value={stats.staff} />
          <StatCard label="Government-paid" value={stats.gov} />
          <StatCard label="Away today" value={stats.away} />
          {stats.pendingLeave !== null && <StatCard label="Leave to decide" value={stats.pendingLeave} />}
          {stats.ending !== null && <StatCard label="Contracts ending (90 days)" value={stats.ending} />}
          {stats.posts !== null && <StatCard label="Posts to approve" value={stats.posts} />}
        </div>
      )}
      {can('hr.self.details') && (
        <Section title="My HR" hint="Your payslips, leave, duties and details.">
          <Link className="text-sm font-semibold text-primary underline" href="/hr/me">Open My HR</Link>
        </Section>
      )}
    </div>
  );
}
