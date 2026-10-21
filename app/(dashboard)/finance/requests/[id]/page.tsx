import { getAccess } from '@/lib/access';
import { TYPE_LABEL, getRequest } from '@/lib/finance/requests';
import { listFunds } from '@/lib/finance/setup';
import { listSuppliers } from '@/lib/finance/spending';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { RequestForm } from '@/components/finance/RequestForm';
import { METHOD_OPTIONS, Money, Notice, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { FormAction } from '@/components/finance/FormAction';
import { formatMoney, plainAmount } from '@/lib/finance/money';

export const metadata = { title: 'Expense request · Pfuma' };

export default async function RequestPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.requests.view') && !can('finance.requests.create') && !can('finance.requests.approve') && !can('finance.requests.disburse')) return <AccessDenied />;
  let r;
  try {
    r = await getRequest(user, params.id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) return <EmptyState title="Request not found" cta={{ label: 'Expense requests', href: '/finance/requests' }} />;
    throw e;
  }
  const mine = r.requestedById === user.id;
  const approvedByMe = r.approvedById === user.id;
  const crumbs = [{ label: 'Finance', href: '/finance' }, { label: 'Expense requests', href: '/finance/requests' }, { label: r.requestNumber }];

  if (r.status === 'DRAFT' && mine && can('finance.requests.create')) {
    const [funds, currencies, suppliers] = await Promise.all([listFunds(user), getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId)), listSuppliers(user).catch(() => [])]);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader title={`${r.requestNumber} · draft`} breadcrumbs={crumbs} actions={<RowAction label="Delete the draft" variant="danger" method="DELETE" url={`/api/finance/requests/${r.id}`} confirm="Delete this draft? Only drafts can be deleted." done="Draft deleted" redirectTo="/finance/requests" />} />
        <RequestForm funds={funds.filter((f) => f.active)} currencies={currencies} suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} initial={{ id: r.id, supplierId: r.supplierId, neededBy: r.neededBy, quoteKeys: r.quoteKeys, title: r.title, type: r.type, department: r.department, justification: r.justification, fundId: r.fundId, currency: r.currency, items: r.items }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`${r.requestNumber} · ${r.title}`} description={`${TYPE_LABEL[r.type]} · ${r.department} · ${r.fundName} fund`} breadcrumbs={crumbs} actions={<StatusBadge status={r.status} />} />
      <Section title="What is asked for">
        <p className="text-sm text-ink">{r.justification}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem]">
            <thead><tr><Th>Line</Th><Th className="text-right">Quantity</Th><Th className="text-right">Each</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody>
              {r.items.map((i) => <tr key={i.id} className="border-t border-line"><Td>{i.description}</Td><Td className="text-right">{i.quantity}</Td><Td className="text-right"><Money cents={i.unitCents} currency={r.currency} /></Td><Td className="text-right"><Money cents={i.totalCents} currency={r.currency} /></Td></tr>)}
              <tr className="border-t border-line"><Td className="font-semibold" >Total asked for</Td><Td /><Td /><Td className="text-right font-semibold"><Money cents={r.estimatedCents} currency={r.currency} /></Td></tr>
              {r.paidCents !== null && <tr><Td className="font-semibold">Paid</Td><Td /><Td /><Td className="text-right font-semibold"><Money cents={r.paidCents} currency={r.currency} /></Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      {r.budget && (
        <Section title={`The ${r.fundName} fund`} hint="For information. A request over the budget or the fund’s balance is allowed, but you are told.">
          <p className="text-sm text-ink">The fund holds <Money cents={r.budget.fundHoldsCents} currency={r.currency} />.{r.budget.budgetThisTermCents !== null && <> Budget for {r.budget.termName}: <Money cents={r.budget.budgetThisTermCents} currency={r.currency} />, spent so far <Money cents={r.budget.spentThisTermCents} currency={r.currency} />.</>}</p>
          {r.budget.fundHoldsCents < r.estimatedCents && <Notice tone="warn">The fund holds less than this request asks for.</Notice>}
          {r.budget.budgetThisTermCents !== null && r.budget.spentThisTermCents + r.estimatedCents > r.budget.budgetThisTermCents && <Notice tone="warn">Paying this would take spending above the budget for the term.</Notice>}
        </Section>
      )}
      <Section title="Who did what">
        <ol className="flex flex-col gap-1 text-sm text-ink">
          <li>Raised by <strong>{r.requestedBy}</strong>{r.submittedAt ? ` on ${r.submittedAt.slice(0, 10)}` : ' (not submitted yet)'}</li>
          {r.supplierName && <li>Supplier: <strong>{r.supplierName}</strong>{r.neededBy ? `, needed by ${r.neededBy}` : ''}</li>}
          {r.quoteKeys.length > 0 && <li>{r.quoteKeys.length} quote{r.quoteKeys.length === 1 ? '' : 's'} attached</li>}
          {r.firstApprovedBy && !r.approvedBy && <li>First approval by <strong>{r.firstApprovedBy}</strong>. It is above the Head’s limit{r.headLimitCents !== null ? ` of ${formatMoney(r.headLimitCents, r.currency)}` : ''}, so a second person must approve it.</li>}
          {r.approvedBy && <li>Approved by <strong>{r.approvedBy}</strong>{r.firstApprovedBy ? ` (first approval by ${r.firstApprovedBy})` : ''}</li>}
          {r.overrunCents !== null && r.overrunCents > 0 && <li>Payment would exceed the approved amount by <Money cents={r.overrunCents} currency={r.currency} />{r.overrunApprovedBy ? `. Overrun approved by ${r.overrunApprovedBy}.` : '. It needs an approver’s agreement.'}</li>}
          {r.cancelledBy && <li>Cancelled by <strong>{r.cancelledBy}</strong></li>}
          {r.rejectedBy && <li>Rejected by <strong>{r.rejectedBy}</strong>: {r.rejectionReason}</li>}
          {r.paidBy && <li>Paid by <strong>{r.paidBy}</strong>{r.paidAt ? ` on ${r.paidAt.slice(0, 10)}` : ''}</li>}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {r.status === 'DRAFT' && mine && can('finance.requests.create') && <RowAction label="Submit for approval" variant="primary" url={`/api/finance/requests/${r.id}/submit`} done="Submitted" />}
          {(r.status === 'PENDING' || r.status === 'APPROVED') && (mine || can('finance.requests.approve')) && <RowAction label="Cancel the request" variant="ghost" url={`/api/finance/requests/${r.id}/cancel`} confirm="Cancel this request? Nothing will be paid for it." done="Cancelled" />}
          {r.status === 'APPROVED' && r.overrunCents !== null && r.overrunCents > 0 && !r.overrunApprovedBy && can('finance.requests.approve') && !mine && <RowAction label="Approve the overrun" variant="secondary" url={`/api/finance/requests/${r.id}/overrun`} done="Overrun approved" />}
          {r.status === 'PENDING' && can('finance.requests.approve') && (mine
            ? <Notice tone="info">You raised this request, so someone else approves it.</Notice>
            : <><RowAction label="Approve" variant="primary" url={`/api/finance/requests/${r.id}/decide`} body={{ decision: 'approve' }} done="Approved" /><RowAction label="Reject" variant="danger" title="Reject this request" url={`/api/finance/requests/${r.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3 }} done="Rejected" /></>)}
          {r.status === 'APPROVED' && can('finance.requests.disburse') && (mine || approvedByMe
            ? <Notice tone="info">You {mine ? 'raised' : 'approved'} this request, so someone else pays it.</Notice>
            : <FormAction label="Pay this request" variant="primary" size="md" url={`/api/finance/requests/${r.id}/disburse`} done="Paid. The expense is recorded." intro={`Approved: ${formatMoney(r.estimatedCents, r.currency)}. Pay no more than that.`}
                fields={[{ name: 'method', label: 'How is it paid?', type: 'select', required: true, options: METHOD_OPTIONS }, { name: 'amount', label: 'Amount paid', type: 'money', initial: plainAmount(r.estimatedCents), required: true },
                  { name: 'payee', label: 'Paid to', maxLength: 80 }, { name: 'reference', label: 'Reference', maxLength: 80 }]} />)}
        </div>
      </Section>
    </div>
  );
}
