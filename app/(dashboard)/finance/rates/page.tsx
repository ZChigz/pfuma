import { getAccess } from '@/lib/access';
import { listRates } from '@/lib/finance/rates';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, Section, Td, Th } from '@/components/finance/shared';

export const metadata = { title: 'Exchange rates · Pfuma' };

export default async function RatesPage() {
  const { user, can } = await getAccess();
  if (!can('finance.rates.view') && !can('finance.rates.manage') && !can('finance.payments.record') && !can('finance.reports.view')) return <AccessDenied />;
  const r = await listRates(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Exchange rates" description="US dollars to ZiG. The rate used for a payment is the one in force on the date it was received. Rows are never changed; a correction is a new row."
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Exchange rates' }]}
        actions={can('finance.rates.manage') ? (
          <FormAction label="Set a new rate" variant="primary" size="md" url="/api/finance/rates" done="Rate saved"
            fields={[
              { name: 'usdToZig', label: 'ZiG for one US dollar', type: 'number', required: true, placeholder: '27.00' },
              { name: 'effectiveFrom', label: 'Effective from', type: 'date', hint: 'Leave empty for now' },
              { name: 'source', label: 'Source', type: 'select', required: true, initial: 'SCHOOL', options: [{ value: 'RBZ', label: 'Reserve Bank' }, { value: 'SCHOOL', label: 'School' }, { value: 'OTHER', label: 'Other' }] },
              { name: 'note', label: 'Note', maxLength: 200 },
            ]} />
        ) : undefined} />
      {r.stale && <Notice tone="warn">{r.current ? `The newest rate is ${r.ageDays} day${r.ageDays === 1 ? '' : 's'} old (the school expects one at least every ${r.staleAfterDays} days).` : 'No exchange rate has been set.'} A payment in ZiG for a US dollar charge cannot be taken without a rate for its date.</Notice>}
      {r.current && <p className="text-sm text-ink">In force now: <strong>1 US$ = ZiG {r.current.usdToZig}</strong> since {r.current.effectiveFrom.slice(0, 10)}.</p>}
      <Section title="History">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem]">
            <thead><tr><Th>From</Th><Th className="text-right">ZiG per US$</Th><Th>Source</Th><Th>Set by</Th><Th>Note</Th></tr></thead>
            <tbody>
              {r.rows.map((x) => <tr key={x.id} className="border-t border-line"><Td>{x.effectiveFrom.slice(0, 16).replace('T', ' ')}</Td><Td className="text-right tabular-nums">{x.usdToZig}</Td><Td>{x.source}</Td><Td>{x.setBy}</Td><Td>{x.note}</Td></tr>)}
              {r.rows.length === 0 && <tr><Td className="text-muted">No rates yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
