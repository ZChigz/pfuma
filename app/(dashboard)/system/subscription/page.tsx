import { getAccess, MODULES } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getModuleStates } from '@/lib/system/modules';
import { subscriptionView } from '@/lib/system/subscription';
import { formatDate } from '@/lib/utils';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata = { title: 'Subscription · Pfuma' };

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  TRIAL: { label: 'Trial', variant: 'info' },
  OVERDUE: { label: 'Overdue', variant: 'warning' },
  SUSPENDED: { label: 'Suspended', variant: 'danger' },
};
const INVOICE_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: 'Unpaid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  VOID: { label: 'Cancelled', variant: 'neutral' },
};

export default async function SubscriptionPage() {
  const { user, can } = await getAccess();
  if (!can('system.subscription.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const [school, modules, enrolled, invoices] = await Promise.all([
    db.school.findUnique({ where: { id: user.schoolId }, select: { status: true, renewalDate: true, studentLimit: true, plan: { select: { name: true, modules: true } } } }),
    getModuleStates(db),
    db.student.count({ where: { status: 'ACTIVE' } }),
    db.subscriptionInvoice.findMany({ orderBy: [{ issuedOn: 'desc' }, { number: 'desc' }] }),
  ]);
  const view = school ? subscriptionView(school) : null;
  const included = MODULES.filter((m) => modules[m.key] && (m.key === 'system' || !school?.plan || school.plan.modules.includes(m.key)));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Subscription"
        description="Your plan with Pfuma, what it includes and what you have been billed"
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Subscription' }]}
      />

      {!view || !school ? (
        <EmptyState title="No subscription on record" description="Contact Pfuma support to set up your plan." />
      ) : (
        <Card title={school.plan?.name ?? 'No plan yet'} action={<Badge variant={STATUS[view.status].variant} label={STATUS[view.status].label} />}>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-subtle">Renewal date</dt>
              <dd className="text-ink">
                {view.renewalDate ? formatDate(view.renewalDate) : 'No renewal date'}
                {view.daysToRenewal !== null && view.daysToRenewal >= 0 && <span className="text-muted"> · in {view.daysToRenewal} day{view.daysToRenewal === 1 ? '' : 's'}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Students</dt>
              <dd className="text-ink">{enrolled} enrolled{view.studentLimit ? ` of ${view.studentLimit} allowed` : ' (no limit)'}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Status</dt>
              <dd className="text-ink">{STATUS[view.status].label}</dd>
            </div>
          </dl>
          {view.studentLimit !== null && enrolled > view.studentLimit && (
            <p role="alert" className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">You have more students than your plan allows. Contact Pfuma to raise the limit.</p>
          )}
          {view.banner && <p role="status" className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">{view.banner.text}</p>}
        </Card>
      )}

      <Card title="Modules included" subtitle="Pfuma turns these on for your school">
        <ul className="flex flex-wrap gap-2">
          {included.map((m) => <li key={m.key}><Badge variant="neutral" label={m.label} /></li>)}
        </ul>
      </Card>

      <Card title="Invoices from Pfuma">
        {invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Invoices">
            <table className="w-full min-w-[520px] text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Number</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5 pr-3 font-mono text-xs">{i.number}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{formatDate(i.issuedOn)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{i.currency} {i.amount.toFixed(2)}</td>
                    <td className="py-2.5 pr-3"><Badge variant={INVOICE_STATUS[i.status].variant} label={INVOICE_STATUS[i.status].label} /></td>
                    <td className="py-2.5 text-right">
                      <a href={`/api/system/subscription/invoices/${i.id}/pdf`} download className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline">Download PDF</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
