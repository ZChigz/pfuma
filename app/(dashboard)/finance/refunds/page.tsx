import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listRefunds } from '@/lib/finance/refunds';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { METHOD_OPTIONS, Money, Pager, methodLabel } from '@/components/finance/format';

export const metadata = { title: 'Refunds · Pfuma' };

const TABS = [['', 'All'], ['REQUESTED', 'Asked for'], ['APPROVED', 'To pay out'], ['PAID', 'Paid out'], ['REJECTED', 'Rejected']] as const;

export default async function RefundsPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.refunds.request') && !can('finance.refunds.approve') && !can('finance.refunds.pay') && !can('finance.payments.view')) return <AccessDenied />;
  const status = (['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const).find((s) => s === searchParams.status);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const list = await listRefunds(user, { status, page, pageSize: 50 });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Refunds" description="One person asks, a second approves, a third pays the money out. Ask for a refund from the student's account." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Refunds' }]} />
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-white p-1" aria-label="Status">
        {TABS.map(([v, label]) => <Link key={v} href={`/finance/refunds?status=${v}`} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${(status ?? '') === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
      </nav>
      <Section title={`${list.total} refund${list.total === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem]">
            <thead><tr><Th>Student</Th><Th>Receipt</Th><Th>Taken from</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.rows.map((r) => {
                const asked = r.requestedById === user.id;
                const approved = r.approvedById === user.id;
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <Td><Link className="underline" href={`/finance/accounts/${r.studentId}`}>{r.studentName}</Link></Td><Td>{r.receiptNumber}<div className="text-xs text-muted">{r.fundName}</div></Td><Td>{r.charge ?? 'Unallocated credit'}</Td>
                    <Td className="text-right"><Money cents={r.amountCents} currency={r.currency} /></Td>
                    <Td className="max-w-[16rem]"><div>{r.reason}</div><div className="text-xs text-muted">Asked by {r.requestedBy}{r.approvedBy ? ` · approved by ${r.approvedBy}` : ''}{r.paidBy ? ` · paid by ${r.paidBy} (${r.method ? methodLabel(r.method) : ''})` : ''}{r.rejectionReason ? ` · ${r.rejectionReason}` : ''}</div></Td>
                    <Td><StatusBadge status={r.status} /></Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {r.status === 'REQUESTED' && can('finance.refunds.approve') && (asked ? <span className="text-xs text-muted">You asked for this.</span> : <><RowAction label="Approve" variant="primary" url={`/api/finance/refunds/${r.id}/decide`} body={{ decision: 'approve' }} done="Approved" /><RowAction label="Reject" variant="danger" title="Reject" url={`/api/finance/refunds/${r.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3 }} done="Rejected" /></>)}
                        {r.status === 'APPROVED' && can('finance.refunds.pay') && (asked || approved ? <span className="max-w-[10rem] text-xs text-muted">You {asked ? 'asked for' : 'approved'} this, so someone else pays it out.</span>
                          : <RowAction label="Pay out" variant="primary" title="Pay out this refund" url={`/api/finance/refunds/${r.id}/pay`} fields={[{ name: 'method', label: 'How is it paid?', options: METHOD_OPTIONS }, { name: 'reference', label: 'Reference', optional: true }]} done="Refund paid out" />)}
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {list.rows.length === 0 && <tr><Td className="text-muted">No refunds.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/finance/refunds?status=${status ?? ''}&page=${p}`} />
      </Section>
    </div>
  );
}
