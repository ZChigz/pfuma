import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getModuleStates } from '@/lib/system/modules';
import { subscriptionView } from '@/lib/system/subscription';
import { formatDate } from '@/lib/utils';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ModuleSwitches } from '@/components/system/ModuleSwitches';

export const metadata = { title: 'Subscription · Pfuma' };

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  TRIAL: { label: 'Trial', variant: 'info' },
  EXPIRED: { label: 'Expired', variant: 'danger' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
};

export default async function SubscriptionPage() {
  const { user, can } = await getAccess();
  if (!can('system.subscription.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const [sub, modules, students] = await Promise.all([
    db.subscription.findFirst(),
    getModuleStates(db),
    db.student.count({ where: { status: 'ACTIVE' } }),
  ]);
  const view = sub ? subscriptionView(sub) : null;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Subscription"
        description="Your plan and the modules your school uses"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Subscription' }]}
      />

      {!view ? (
        <EmptyState title="No subscription on record" description="Contact Pfuma support to set up your plan." />
      ) : (
        <Card title={`${view.plan.charAt(0)}${view.plan.slice(1).toLowerCase()} plan`} action={<Badge variant={STATUS[view.status].variant} label={STATUS[view.status].label} />}>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-subtle">Started</dt><dd className="text-ink">{formatDate(view.startsAt)}</dd></div>
            <div>
              <dt className="text-xs text-subtle">Ends</dt>
              <dd className="text-ink">
                {view.endsAt ? formatDate(view.endsAt) : 'No end date'}
                {view.daysLeft !== null && view.daysLeft >= 0 && <span className="text-muted"> · {view.daysLeft} day{view.daysLeft === 1 ? '' : 's'} left</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Active students</dt>
              <dd className="text-ink">{students}{view.studentLimit ? ` of ${view.studentLimit}` : ' (no limit)'}</dd>
            </div>
          </dl>
          {view.studentLimit !== null && students > view.studentLimit && (
            <p role="alert" className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">You have more active students than your plan allows.</p>
          )}
          {(view.status === 'EXPIRED' || view.expiringSoon) && (
            <p role="status" className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">
              {view.status === 'EXPIRED' ? 'This subscription has expired.' : 'This subscription is ending soon.'} Contact Pfuma support to renew.
            </p>
          )}
        </Card>
      )}

      <Card title="Modules" subtitle="Switch off the parts of Pfuma your school does not use">
        <ModuleSwitches initial={modules} canManage={can('system.subscription.manage')} />
      </Card>
    </div>
  );
}
