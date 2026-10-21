import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getSiblingRule, listRules } from '@/lib/finance/discounts';
import { listCatalog } from '@/lib/finance/structures';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Money, RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Discounts · Pfuma' };

const TABS = [['', 'All'], ['PENDING', 'To approve'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']] as const;

export default async function DiscountsPage({ searchParams }: { searchParams: { status?: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.adjustments.create') && !can('finance.adjustments.approve') && !can('finance.accounts.view')) return <AccessDenied />;
  const status = (['PENDING', 'APPROVED', 'REJECTED'] as const).find((s) => s === searchParams.status);
  const [rules, sibling, catalog] = await Promise.all([listRules(user, { status }), getSiblingRule(user).catch(() => null), listCatalog(user).catch(() => [])]);
  const approve = can('finance.adjustments.approve');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Discounts" description="Standing discounts (staff children, hardship, early payment) are asked for by the bursar and approved by someone else. Approved ones apply by themselves every time a term is billed." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Discounts' }]} />
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-white p-1" aria-label="Status">
        {TABS.map(([v, label]) => <Link key={v} href={`/finance/discounts?status=${v}`} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${(status ?? '') === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
      </nav>
      {sibling && (
        <Section title="Sibling discount" hint="The percentage taken off for the second and third child of the same fee payer, on the fee items chosen. The Head approves it before billing uses it."
          action={can('finance.fees.manage') ? (
            <FormAction label="Set the rule" size="md" url="/api/finance/sibling-rule" method="PUT" done="Saved. It applies once approved."
              fields={[
                { name: 'pct2', label: 'Second child (%)', type: 'number', required: true, initial: String(sibling.pct2) },
                { name: 'pct3', label: 'Third child and after (%)', type: 'number', required: true, initial: String(sibling.pct3) },
              ]} />
          ) : undefined}>
          <p className="text-sm text-ink">Second child {sibling.pct2}% · third child and after {sibling.pct3}% · on {sibling.catalogItemIds.length ? sibling.catalogItemIds.map((id) => catalog.find((c) => c.id === id)?.name ?? '').filter(Boolean).join(', ') : 'tuition and every other recurring item'}.</p>
          <p className="mt-1 text-xs text-muted">{sibling.approved ? `Approved by ${sibling.approvedBy}.` : sibling.setBy ? `Set by ${sibling.setBy}, waiting for approval.` : 'Not set.'}</p>
          {!sibling.approved && sibling.setBy && approve && sibling.setById !== user.id && <div className="mt-2"><RowAction label="Approve the rule" variant="primary" url="/api/finance/sibling-rule/approve" done="Approved" /></div>}
          {!sibling.approved && sibling.setBy && approve && sibling.setById === user.id && <p className="mt-1 text-xs text-muted">You set this rule, so someone else approves it.</p>}
        </Section>
      )}
      <Section title={`${rules.length} discount${rules.length === 1 ? '' : 's'}`} hint="To ask for one, open the learner's account and choose “Ask for a discount”.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem]">
            <thead><tr><Th>Learner</Th><Th>Kind</Th><Th className="text-right">Amount</Th><Th>From</Th><Th>Reason</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <Td><Link className="underline" href={`/finance/accounts/${r.studentId}`}>{r.studentName}</Link></Td>
                  <Td>{r.kindLabel}{r.items.length > 0 && <div className="text-xs text-muted">{r.items.join(', ')}</div>}</Td>
                  <Td className="text-right">{r.percent !== null ? `${r.percent}%` : r.amountCents !== null && r.currency ? <Money cents={r.amountCents} currency={r.currency} /> : '—'}</Td>
                  <Td>{r.termFrom}{r.standing ? ' · until ended' : r.termTo ? ` to ${r.termTo}` : ' · that term only'}</Td>
                  <Td className="max-w-[16rem]"><div>{r.reason}</div><div className="text-xs text-muted">Asked by {r.createdBy}{r.decidedBy ? ` · decided by ${r.decidedBy}` : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</div></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {r.status === 'PENDING' && approve && (r.createdById === user.id ? <span className="max-w-[10rem] text-xs text-muted">You asked for this, so someone else decides.</span> : <>
                        <RowAction label="Approve" variant="primary" url={`/api/finance/discounts/${r.id}/decide`} body={{ decision: 'approve' }} done="Approved" />
                        <RowAction label="Reject" variant="danger" url={`/api/finance/discounts/${r.id}/decide`} body={{ decision: 'reject' }} reason={{ label: 'Why is it rejected?', min: 3, field: 'note' }} done="Rejected" />
                      </>)}
                      {r.status === 'APPROVED' && r.standing && (approve || can('finance.adjustments.create')) && <RowAction label="End it" variant="ghost" url={`/api/finance/discounts/${r.id}/end`} confirm="Stop applying this discount from the next billing?" done="Ended" />}
                    </div>
                  </Td>
                </tr>
              ))}
              {rules.length === 0 && <tr><Td className="text-muted">No discounts here.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
