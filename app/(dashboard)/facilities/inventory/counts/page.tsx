import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listCounts, listStores } from '@/lib/facilities/inventory';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { InventoryNav } from '@/components/facilities/InventoryNav';

export const metadata = { title: 'Stock counts · Pfuma' };
const STATUS: Record<string, { v: 'neutral' | 'warning' | 'success'; label: string }> = { OPEN: { v: 'warning', label: 'Counting' }, SUBMITTED: { v: 'warning', label: 'Waiting for the Head' }, APPROVED: { v: 'success', label: 'Posted' }, CLOSED: { v: 'neutral', label: 'Closed' } };

export default async function CountsPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.inventory.count') && !can('facilities.inventory.writeoff')) return <AccessDenied />;
  const [counts, { stores }] = await Promise.all([listCounts(user), listStores(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Stock counts" description="Count a store, see the difference per item, and post it. Differences worth more than the school's limit are approved by the Head first."
        actions={can('facilities.inventory.count') && (
          <FormAction label="Start a count" size="md" variant="primary" url="/api/facilities/inventory/counts" done="Count started"
            fields={[{ name: 'storeId', label: 'Store', type: 'select', required: true, options: stores.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })) }]} />
        )} />
      <InventoryNav can={can} current="/facilities/inventory/counts" />
      <Section title="Counts">
        {counts.length === 0 ? <p className="text-sm text-muted">No counts yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[28rem]"><thead><tr><Th>Store</Th><Th>Date</Th><Th>Status</Th><Th /></tr></thead><tbody>
            {counts.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <Td>{c.store}</Td><Td>{c.countedAt.slice(0, 10)}</Td>
                <Td><Badge variant={STATUS[c.status]?.v ?? 'neutral'} label={STATUS[c.status]?.label ?? c.status} /></Td>
                <Td><Link className="inline-flex min-h-[44px] items-center font-semibold text-primary underline" href={`/facilities/inventory/counts/${c.id}`}>{c.status === 'OPEN' ? 'Count' : 'Open'}</Link></Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}
