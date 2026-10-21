import { getAccess } from '@/lib/access';
import { listPlans } from '@/lib/finance/plans';
import { getScopedDb } from '@/lib/scoped-db';
import { enabledCurrencies } from '@/lib/finance/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { PlanForm } from '@/components/finance/PlanForm';
import { Money, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Payment plans · Pfuma' };

export default async function PlansPage() {
  const { user, can } = await getAccess();
  if (!can('finance.plans.manage') && !can('finance.plans.approve') && !can('finance.statements.view') && !can('finance.accounts.view')) return <AccessDenied />;
  const [plans, currencies] = await Promise.all([listPlans(user), getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId))]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Payment plans" description="A fee payer agrees to clear a debt in instalments. Each instalment shows Due, Paid or Missed as money arrives; the fee payer gets a text three days before each date. A plan that runs past this term needs the Head's approval."
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Payment plans' }]} actions={can('finance.plans.manage') ? <PlanForm currencies={currencies} /> : undefined} />
      <Section title={`${plans.length} plan${plans.length === 1 ? '' : 's'}`}>
        <div className="flex flex-col gap-3">
          {plans.map((p) => (
            <div key={p.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{p.guardian} <span className="font-normal text-muted">for {p.students.join(', ')}</span></p>
                  <p className="text-xs text-muted">{p.phone} · total <Money cents={p.totalCents} currency={p.currency} /> · started {p.startDate} · recorded by {p.createdBy}{p.approvedBy ? ` · approved by ${p.approvedBy}` : ''}</p>
                  {p.notes && <p className="text-xs text-muted">{p.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={p.status} />
                  {p.status === 'PENDING_APPROVAL' && can('finance.plans.approve') && (p.createdById === user.id ? <span className="max-w-[10rem] text-xs text-muted">You recorded this plan.</span> : <>
                    <RowAction label="Approve" variant="primary" url={`/api/finance/plans/${p.id}/decide`} body={{ decision: 'approve' }} done="Plan approved" />
                    <RowAction label="Reject" variant="danger" url={`/api/finance/plans/${p.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3, field: 'note' }} done="Plan rejected" />
                  </>)}
                  {(p.status === 'ACTIVE' || p.status === 'PENDING_APPROVAL') && (can('finance.plans.manage') || can('finance.plans.approve')) && <RowAction label="Cancel the plan" variant="ghost" url={`/api/finance/plans/${p.id}/cancel`} reason={{ label: 'Why is it cancelled?', min: 5 }} done="Plan cancelled" />}
                </div>
              </div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {p.instalments.map((i) => <tr key={i.id} className="border-t border-line"><Td>{i.dueDate}</Td><Td className="text-right"><Money cents={i.amountCents} currency={p.currency} /></Td><Td><StatusBadge status={i.status} /></Td></tr>)}
                </tbody>
              </table>
            </div>
          ))}
          {plans.length === 0 && <p className="text-sm text-muted">No payment plans yet.</p>}
        </div>
      </Section>
    </div>
  );
}
