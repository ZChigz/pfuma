import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { TYPE_LABEL, listRequests } from '@/lib/finance/requests';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { Money, Pager, linkButton, primaryLink } from '@/components/finance/format';

export const metadata = { title: 'Expense requests · Pfuma' };

const TABS = [['', 'All'], ['DRAFT', 'Drafts'], ['PENDING', 'To approve'], ['APPROVED', 'To pay'], ['DISBURSED', 'Paid'], ['REJECTED', 'Rejected']] as const;

export default async function RequestsPage({ searchParams }: { searchParams: { status?: string; mine?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.requests.view') && !can('finance.requests.create') && !can('finance.requests.approve') && !can('finance.requests.disburse')) return <AccessDenied />;
  const status = (['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'DISBURSED'] as const).find((s) => s === searchParams.status);
  const page = Math.max(1, Number(searchParams.page) || 1);
  const mine = searchParams.mine === '1';
  const list = await listRequests(user, { status, mine, page, pageSize: 50 });
  const q = (over: Record<string, string>) => `/finance/requests?${new URLSearchParams(Object.fromEntries(Object.entries({ status: status ?? '', mine: mine ? '1' : '', ...over }).filter(([, v]) => v)))}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Expense requests" description="Spending goes out in three steps: one person asks, a second approves, a third pays. Nobody does two of the three." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Expense requests' }]}
        actions={can('finance.requests.create') ? <Link href="/finance/requests/new" className={primaryLink}>New request</Link> : undefined} />
      <nav className="flex flex-wrap items-center gap-2" aria-label="Status">
        <div className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
          {TABS.map(([v, label]) => <Link key={v} href={q({ status: v, page: '' })} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${(status ?? '') === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
        </div>
        {(can('finance.requests.view') || can('finance.requests.approve') || can('finance.requests.disburse')) && <Link href={q({ mine: mine ? '' : '1', page: '' })} className={linkButton}>{mine ? 'Show everyone’s' : 'Show only mine'}</Link>}
      </nav>
      <Section title={`${list.total} request${list.total === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Number</Th><Th>Title</Th><Th>Fund</Th><Th className="text-right">Asked for</Th><Th className="text-right">Paid</Th><Th>Raised by</Th><Th>Status</Th></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <Td><Link className="font-semibold text-primary underline" href={`/finance/requests/${r.id}`}>{r.requestNumber}</Link></Td>
                  <Td>{r.title}<div className="text-xs text-muted">{TYPE_LABEL[r.type]} · {r.department}</div></Td><Td>{r.fundName}</Td>
                  <Td className="text-right"><Money cents={r.estimatedCents} currency={r.currency} /></Td><Td className="text-right">{r.paidCents !== null ? <Money cents={r.paidCents} currency={r.currency} /> : ''}</Td>
                  <Td>{r.requestedBy}{r.approvedBy && <div className="text-xs text-muted">approved by {r.approvedBy}</div>}{r.paidBy && <div className="text-xs text-muted">paid by {r.paidBy}</div>}</Td>
                  <Td><StatusBadge status={r.status === 'PENDING' ? 'PENDING' : r.status} /></Td>
                </tr>
              ))}
              {list.rows.length === 0 && <tr><Td className="text-muted">No requests.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => q({ page: String(p) })} />
      </Section>
    </div>
  );
}
