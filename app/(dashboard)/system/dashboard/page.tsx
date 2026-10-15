import { Suspense } from 'react';
import Link from 'next/link';
import { ClassesCard } from '@/components/system/cards/ClassesCard';
import { StaffCard } from '@/components/system/cards/StaffCard';
import { StudentsCard } from '@/components/system/cards/StudentsCard';
import { SummaryCardSkeleton } from '@/components/system/cards/SummaryCard';
import { TermCard } from '@/components/system/cards/TermCard';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { getDashboardData } from '@/lib/system/dashboard';
import { subscriptionView } from '@/lib/system/subscription';
import { checklistVisible, evaluateSetup, loadSetupFacts, summarize } from '@/lib/system/setup-checklist';
import { SetupChecklist } from '@/components/system/SetupChecklist';
import { termLabel } from '@/lib/term-label';
import { formatDate, formatDateTime, formatUSD, formatZiG } from '@/lib/utils';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';

export const metadata = { title: 'Dashboard · Pfuma' };

const money = (m: { USD: number; ZIG: number }) =>
  [m.USD ? formatUSD(m.USD) : null, m.ZIG ? formatZiG(m.ZIG) : null].filter(Boolean).join(' + ') || formatUSD(0);

export default async function DashboardPage() {
  const { user, can } = await getAccess();
  if (!can('system.dashboard.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const { term } = await getViewTerm(user.schoolId, db);
  const showFinance = can('finance.payments.view');
  const showAudit = can('system.audit.view');
  const showSetup = can('system.setup.view');
  const [data, sub, setup] = await Promise.all([
    getDashboardData(db, user.schoolId, term, { finance: showFinance, audit: showAudit }),
    can('system.subscription.view') ? db.subscription.findFirst() : Promise.resolve(null),
    showSetup
      ? Promise.all([loadSetupFacts(db, user.schoolId, term), db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { setupChecklistPinned: true } })])
      : Promise.resolve(null),
  ]);
  const steps = setup ? evaluateSetup(setup[0]) : null;
  const pinned = setup?.[1].setupChecklistPinned ?? false;
  const subscription = sub ? subscriptionView(sub) : null;

  return (
    <div className="flex flex-col gap-5 pb-6">
      <PageHeader
        title="Dashboard"
        description={term ? `Showing ${termLabel(term.name)}${term.status === 'OPEN' ? ' (the open term)' : ''}` : 'No term has been set up yet'}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Dashboard' }]}
      />

      {steps && checklistVisible(summarize(steps).complete, pinned) && <SetupChecklist steps={steps} pinned={pinned} />}

      {subscription && (subscription.status === 'EXPIRED' || subscription.expiringSoon) && (
        <div role="status" className="rounded-2xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
          {subscription.status === 'EXPIRED'
            ? 'Your subscription has expired.'
            : `Your subscription ends in ${subscription.daysLeft} day${subscription.daysLeft === 1 ? '' : 's'}.`}{' '}
          {can('system.subscription.view') && <Link href="/system/subscription" className="font-semibold underline">View subscription</Link>}
        </div>
      )}

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
          <Card title="Fees billed" subtitle={termLabel(term.name)}><p className="text-2xl font-semibold tabular-nums text-ink">{money(data.billed)}</p></Card>
          <Card title="Fees collected" subtitle="Verified payments in this term"><p className="text-2xl font-semibold tabular-nums text-ink">{money(data.collected)}</p></Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Coming up" action={can('system.calendar.view') ? <Link href="/system/calendar" className="text-sm font-medium text-primary hover:underline">Calendar</Link> : undefined}>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing on the calendar.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.upcoming.map((e) => (
                <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-ink">{e.title}</p>
                  <p className="text-xs text-muted">{formatDate(e.startDate)}{e.endDate.getTime() !== e.startDate.getTime() ? ` to ${formatDate(e.endDate)}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {showAudit && (
          <Card title="Recent activity" action={<Link href="/system/audit-log" className="text-sm font-medium text-primary hover:underline">Audit log</Link>}>
            {data.recent.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((r) => (
                  <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-sm font-medium text-ink">{r.action.replace(/_/g, ' ').toLowerCase()}{r.detail ? ` · ${r.detail}` : ''}</p>
                    <p className="text-xs text-muted">{r.actor.fullName} · {formatDateTime(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
