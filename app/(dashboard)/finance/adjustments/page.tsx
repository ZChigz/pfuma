import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { KIND_LABEL, listAdjustments } from '@/lib/finance/adjustments';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Money, Pager, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Credit notes · Pfuma' };

const TABS = [['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']] as const;

export default async function AdjustmentsPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.adjustments.approve') && !can('finance.adjustments.create') && !can('finance.accounts.view')) return <AccessDenied />;
  const status = (['PENDING', 'APPROVED', 'REJECTED'] as const).find((s) => s === searchParams.status) ?? (searchParams.status === '' ? undefined : 'PENDING');
  const page = Math.max(1, Number(searchParams.page) || 1);
  const list = await listAdjustments(user, { status, page, pageSize: 50 });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Credit notes and discounts" description="A credit note, discount, bursary or waiver lowers a charge only after a second person approves it. Ask for one from the student's account." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Credit notes' }]} />
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-white p-1" aria-label="Status">
        {TABS.map(([v, label]) => <Link key={v} href={`/finance/adjustments?status=${v}`} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${(status ?? '') === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
      </nav>
      <Section title={`${list.total} item${list.total === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem]">
            <thead><tr><Th>Student</Th><Th>For</Th><Th>Kind</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.rows.map((a) => (
                <tr key={a.id} className="border-t border-line align-top">
                  <Td><Link className="underline" href={`/finance/accounts/${a.studentId}`}>{a.studentName}</Link></Td><Td>{a.charge}<div className="text-xs text-muted">{a.fundName}</div></Td><Td>{KIND_LABEL[a.kind]}</Td>
                  <Td className="text-right"><Money cents={a.amountCents} currency={a.currency} /></Td>
                  <Td className="max-w-[16rem]"><div>{a.reason}</div><div className="text-xs text-muted">Asked by {a.createdBy}{a.decidedBy ? ` · decided by ${a.decidedBy}` : ''}{a.decisionNote ? ` — ${a.decisionNote}` : ''}</div></Td>
                  <Td><StatusBadge status={a.status} /></Td>
                  <Td>
                    {a.status === 'PENDING' && can('finance.adjustments.approve') && (a.createdById !== user.id
                      ? <div className="flex gap-2"><RowAction label="Approve" variant="primary" url={`/api/finance/adjustments/${a.id}/decide`} body={{ decision: 'approve' }} done="Approved" /><RowAction label="Reject" variant="danger" title="Reject" url={`/api/finance/adjustments/${a.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3, field: 'note' }} done="Rejected" /></div>
                      : <span className="text-xs text-muted">You asked for this, so someone else decides.</span>)}
                  </Td>
                </tr>
              ))}
              {list.rows.length === 0 && <tr><Td className="text-muted">Nothing here.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => `/finance/adjustments?status=${status ?? ''}&page=${p}`} />
      </Section>
    </div>
  );
}
