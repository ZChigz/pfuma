import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listStores, stockTable, CATEGORIES } from '@/lib/facilities/inventory';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Notice, Section, Td, Th } from '@/components/finance/shared';
import { InventoryNav } from '@/components/facilities/InventoryNav';
import { StockActions } from '@/components/facilities/StockActions';

export const metadata = { title: 'Inventory · Pfuma' };
const money = (c: number, cur: string | null) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default async function InventoryPage({ searchParams }: { searchParams: { store?: string; q?: string; category?: string; low?: string } }) {
  const { user, can } = await getAccess();
  const seeing = ['view', 'manage', 'receive', 'issue', 'count', 'writeoff'].some((k) => can(`facilities.inventory.${k}` as never));
  if (!seeing) return <AccessDenied />;
  const { stores, people } = await listStores(user);
  const store = stores.find((s) => s.id === searchParams.store) ?? null;
  const { rows, days } = await stockTable(user, { storeId: store?.id, q: searchParams.q, category: searchParams.category, lowOnly: searchParams.low === '1' });
  const live = stores.filter((s) => s.active);
  const low = rows.filter((r) => r.low).length;
  const soon = rows.filter((r) => r.expiringSoon > 0).length;
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ store: store?.id, category: searchParams.category, low: searchParams.low, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/facilities/inventory${p.size ? `?${p}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Inventory and stores" description="What each store holds, worked out from every delivery, issue and sale. Stock can never go below zero."
        actions={can('facilities.inventory.manage') && (
          <div className="flex flex-wrap gap-2">
            <FormAction label="Add an item" size="md" url="/api/facilities/inventory/items" done="Item added"
              fields={[{ name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES.map((c) => ({ value: c, label: label(c) })) },
                { name: 'unit', label: 'Unit', type: 'select', initial: 'EACH', options: ['EACH', 'BOX', 'KG', 'LITRE'].map((u) => ({ value: u, label: label(u) })) }, { name: 'size', label: 'Size or variant (uniforms)' },
                { name: 'gender', label: 'Gender (uniforms)', type: 'select', options: [{ value: 'M', label: 'Boys' }, { value: 'F', label: 'Girls' }] }, { name: 'barcode', label: 'Barcode' },
                { name: 'reorderLevel', label: 'Reorder level', type: 'number', initial: '0' }, { name: 'priceCents', label: 'Selling price, if sold to learners', type: 'cents' },
                { name: 'priceCurrency', label: 'Price currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] },
                { name: 'tracksExpiry', label: 'Has an expiry date (food, medicine)', type: 'bool', initial: 'no' }]} />
            <FormAction label="Add a store" size="md" url="/api/facilities/inventory/stores" done="Store added"
              fields={[{ name: 'name', label: 'Store name', required: true }, { name: 'storekeeperId', label: 'Storekeeper', type: 'select', options: people.map((p) => ({ value: p.id, label: p.fullName })) }]} />
          </div>
        )} />
      <InventoryNav can={can} current="/facilities/inventory" />

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href={href({ store: undefined })} className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${!store ? 'bg-primary text-white' : 'bg-white text-muted'}`}>All stores</Link>
        {live.map((s) => <Link key={s.id} href={href({ store: s.id })} className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${store?.id === s.id ? 'bg-primary text-white' : 'bg-white text-muted'}`}>{s.name}</Link>)}
      </div>

      {(low > 0 || soon > 0) && (
        <Notice tone="warn">
          {low > 0 && <span>{low} item{low === 1 ? ' is' : 's are'} at or below the reorder level. <Link className="underline" href={href({ low: '1' })}>Show them</Link>. </span>}
          {soon > 0 && <span>{soon} item{soon === 1 ? ' has' : 's have'} stock expiring within {days} days.</span>}
        </Notice>
      )}

      {store && can('facilities.inventory.issue') && (
        <StockActions stores={live.map((s) => ({ id: s.id, name: s.name }))} storeId={store.id} can={{ issue: true, writeoff: can('facilities.inventory.writeoff') }}
          items={rows.filter((r) => r.active).map((r) => ({ id: r.itemId, name: r.name, size: r.size, unit: r.unit, qty: r.qty, priceCents: r.priceCents, priceCurrency: r.priceCurrency }))} />
      )}
      {!store && can('facilities.inventory.issue') && <Notice tone="info">Choose a store above to issue, sell or move its stock.</Notice>}

      <Section title={store ? `${store.name}${store.storekeeper ? ` · storekeeper ${store.storekeeper}` : ''}` : 'All stores'}
        hint="Cost is the weighted average of what came in.">
        <form className="mb-3 flex flex-wrap gap-2" action="/facilities/inventory">
          {store && <input type="hidden" name="store" value={store.id} />}
          <input name="q" defaultValue={searchParams.q} placeholder="Search items" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm" />
          <select name="category" defaultValue={searchParams.category ?? ''} className="h-11 rounded-xl border border-line bg-white px-3 text-sm"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
          <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Filter</button>
        </form>
        {rows.length === 0 ? <p className="text-sm text-muted">No items yet.{can('facilities.inventory.manage') ? ' Add the first one above.' : ''}</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem]"><thead><tr><Th>Item</Th><Th>Category</Th><Th className="text-right">On hand</Th><Th className="text-right">Cost each</Th><Th className="text-right">Value</Th><Th className="text-right">Price</Th><Th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.itemId} className={`border-t border-line ${r.active ? '' : 'opacity-60'}`}>
                <Td>{r.name}{r.size ? ` (${r.size}${r.gender ? `, ${r.gender === 'M' ? 'boys' : 'girls'}` : ''})` : ''}{!r.active && <span className="ml-1 text-xs text-muted">not in use</span>}</Td>
                <Td>{label(r.category)}</Td>
                <Td className="text-right font-semibold">{r.qty} <span className="font-normal text-muted">{r.unit.toLowerCase()}</span></Td>
                <Td className="text-right">{r.qty > 0 ? money(r.avgCents, r.costCurrency) : '—'}</Td>
                <Td className="text-right">{r.qty > 0 ? money(r.valueCents, r.costCurrency) : '—'}</Td>
                <Td className="text-right">{r.priceCents != null ? money(r.priceCents, r.priceCurrency) : '—'}</Td>
                <Td>{r.low && <Badge variant="warning" label="Low" />} {r.expiringSoon > 0 && <Badge variant="danger" label="Expiring" />}</Td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}
