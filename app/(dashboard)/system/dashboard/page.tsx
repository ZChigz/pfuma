import { Suspense } from 'react';
import { ClassesCard } from '@/components/system/cards/ClassesCard';
import { StaffCard } from '@/components/system/cards/StaffCard';
import { StudentsCard } from '@/components/system/cards/StudentsCard';
import { SummaryCardSkeleton } from '@/components/system/cards/SummaryCard';
import { TermCard } from '@/components/system/cards/TermCard';
import { ChartSkeleton, EmptyPanel } from '@/components/system/charts/chart-parts';
import { ClassSizeChart } from '@/components/system/charts/ClassSizeChart';
import { EnrolmentChart } from '@/components/system/charts/EnrolmentChart';
import { RecentActivity, UpcomingEvents } from '@/components/system/lists/Lists';
import { QuickActions } from '@/components/system/QuickActions';
import { AcademicsDashboardCards } from '@/components/academics/DashboardCards';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { getDashboardData } from '@/lib/system/dashboard';
import { checklistVisible, evaluateSetup, loadSetupFacts, summarize } from '@/lib/system/setup-checklist';
import { SetupChecklist } from '@/components/system/SetupChecklist';
import { termLabel } from '@/lib/term-label';
import { formatUSD, formatZiG } from '@/lib/utils';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';

export const metadata = { title: 'Dashboard · Pfuma' };

const noMoney = (m: { USD: number; ZIG: number }) => m.USD === 0 && m.ZIG === 0;
const money = (m: { USD: number; ZIG: number }) =>
  [m.USD ? formatUSD(m.USD) : null, m.ZIG ? formatZiG(m.ZIG) : null].filter(Boolean).join(' + ') || formatUSD(0);

export default async function DashboardPage() {
  const { user, can } = await getAccess();
  if (!can('system.dashboard.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const { term } = await getViewTerm(user.schoolId, db);
  const showFinance = can('finance.payments.view');
  const showSetup = can('system.settings.edit');
  const [data, setup] = await Promise.all([
    getDashboardData(db, user.schoolId, term, { finance: showFinance, audit: false }),
    showSetup
      ? Promise.all([loadSetupFacts(db, user.schoolId, term), db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { setupChecklistPinned: true } })])
      : Promise.resolve(null),
  ]);
  const steps = setup ? evaluateSetup(setup[0]) : null;
  const pinned = setup?.[1].setupChecklistPinned ?? false;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <PageHeader
        title="Dashboard"
        description={term ? `Showing ${termLabel(term.name)}${term.status === 'OPEN' ? ' (the open term)' : ''}` : 'No term has been set up yet'}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Dashboard' }]}
      />

      <AcademicsDashboardCards user={user} />

      <QuickActions user={user} />

      {steps && checklistVisible(summarize(steps).complete, pinned) && <SetupChecklist steps={steps} pinned={pinned} />}

      {!term && (
        <EmptyState
          title="No term yet"
          description="Set up the academic year and its three terms to see term figures here."
          cta={{ label: 'Set up the academic calendar', href: '/admin/academic' }}
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense fallback={<SummaryCardSkeleton />}><StudentsCard user={user} term={term} /></Suspense>
        <Suspense fallback={<SummaryCardSkeleton />}><StaffCard user={user} /></Suspense>
        <TermCard user={user} term={term} />
        <Suspense fallback={<SummaryCardSkeleton />}><ClassesCard user={user} term={term} /></Suspense>
      </div>

      {showFinance && term && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Payments to verify" value={data.pendingPayments} tone={data.pendingPayments > 0 ? 'warning' : 'default'} note="Recorded, not yet verified" />
          <Card title="Fees billed" subtitle={termLabel(term.name)}>
            {noMoney(data.billed) ? <EmptyPanel message="No fees billed for this term yet." action={{ label: 'Set up fees', href: '/head/fees' }} /> : <p className="text-2xl font-semibold tabular-nums text-ink">{money(data.billed)}</p>}
          </Card>
          <Card title="Fees collected" subtitle="Verified payments in this term">
            {noMoney(data.collected) ? <EmptyPanel message="No verified payments in this term yet." action={{ label: 'Open payments', href: '/head/payments' }} /> : <p className="text-2xl font-semibold tabular-nums text-ink">{money(data.collected)}</p>}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Suspense fallback={<ChartSkeleton />}><EnrolmentChart user={user} term={term} /></Suspense>
        <Suspense fallback={<ChartSkeleton />}><ClassSizeChart user={user} term={term} /></Suspense>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Suspense fallback={<ChartSkeleton />}><UpcomingEvents user={user} /></Suspense>
        <Suspense fallback={<ChartSkeleton />}><RecentActivity user={user} /></Suspense>
      </div>
    </div>
  );
}
