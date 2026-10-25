import { getAccess } from '@/lib/access';
import { inventoryReports } from '@/lib/facilities/inventory';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { InventoryNav } from '@/components/facilities/InventoryNav';

export const metadata = { title: 'Inventory reports · Pfuma' };
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const zig = (c: number) => `ZiG ${(c / 100).toFixed(2)}`;

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr>{head.map((h) => <Th key={h}>{h}</Th>)}</tr></thead><tbody>
      {rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, k) => <Td key={k} className={typeof c === 'number' ? 'text-right' : ''}>{c}</Td>)}</tr>)}
    </tbody></table></div>
  );
}

export default async function InventoryReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { user, can } = await getAccess();
  const allowed = ['view', 'manage', 'writeoff', 'receive', 'issue', 'count'].some((k) => can(`facilities.inventory.${k}` as never));
  if (!allowed) return <AccessDenied />;
  const r = await inventoryReports(user, { from: searchParams.from, to: searchParams.to });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Inventory reports" description={`Movements from ${r.from} to ${r.to}. Dollars and ZiG are never added together.`} />
      <InventoryNav can={can} current="/facilities/inventory/reports" />
      <form className="flex flex-wrap items-end gap-2" action="/facilities/inventory/reports">
        <label className="text-sm font-medium text-ink">From<input type="date" name="from" defaultValue={r.from} className="mt-1 block h-11 rounded-xl border border-line bg-white px-3 text-sm" /></label>
        <label className="text-sm font-medium text-ink">To<input type="date" name="to" defaultValue={r.to} className="mt-1 block h-11 rounded-xl border border-line bg-white px-3 text-sm" /></label>
        <button className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      <Section title="Stock value per store"><Table head={['Store', 'US dollars', 'ZiG']} rows={r.stockValue.map((s) => [s.store, usd(s.usdCents), zig(s.zigCents)])} empty="No stock yet." /></Section>
      <Section title="Below the reorder level" action={can('facilities.inventory.manage') && r.lowStock.length > 0 ? (
        <FormAction label="Raise a purchase request" url="/api/facilities/inventory/reorder" done="Draft request made in Finance" extra={{ itemIds: Array.from(new Set(r.lowStock.map((x) => x.itemId))).slice(0, 30) }} fields={[]} intro="This makes a draft purchase request in Finance for every item below its reorder level. You can edit it there before sending it for approval." />
      ) : undefined}>
        <Table head={['Item', 'Store', 'On hand', 'Reorder level']} rows={r.lowStock.map((x) => [x.item, x.store, x.qty, x.reorderLevel])} empty="Nothing is running low." />
      </Section>
      <Section title={`Expiring within ${r.days} days`}>
        {r.expiring.length === 0 ? <p className="text-sm text-muted">Nothing is about to expire.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[24rem]"><thead><tr><Th>Item</Th><Th>Store</Th><Th>Expiry</Th><Th className="text-right">Quantity</Th><Th /></tr></thead><tbody>
            {r.expiring.map((e, i) => <tr key={i} className="border-t border-line"><Td>{e.item}</Td><Td>{e.store}</Td><Td>{e.expiry}</Td><Td className="text-right">{e.qty}</Td><Td>{e.expired && <Badge variant="danger" label="Expired" />}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Usage per month"><Table head={['Month', 'Item', 'Used']} rows={r.usageByMonth.map((u) => [u.month, u.item, u.qty])} empty="Nothing was issued or sold in this period." /></Section>
      <Section title="Food per boarder per week" hint={`${r.boarders} boarders on roll today.`}><Table head={['Week', 'Food issued', 'Per boarder']} rows={r.foodPerBoarderPerWeek.map((w) => [w.week, w.qty, w.perBoarder ?? '—'])} empty="No food was issued in this period." /></Section>
      <Section title="Issues per department"><Table head={['Department', 'Item', 'Quantity']} rows={r.issuesByDepartment.map((d) => [d.department, d.item, d.qty])} empty="Nothing was issued in this period." /></Section>
      <Section title="Uniform sales by size"><Table head={['Item', 'Size', 'For', 'Sold']} rows={r.uniformSalesBySize.map((u) => [u.item, u.size, u.gender === 'M' ? 'Boys' : u.gender === 'F' ? 'Girls' : '—', u.qty])} empty="No uniforms were sold in this period." /></Section>
      <Section title="Count differences"><Table head={['Date', 'Item', 'Store', 'Difference', 'Value']} rows={r.countVariances.map((v) => [v.date, v.item, v.store, v.qty, v.currency === 'ZIG' ? zig(v.valueCents) : usd(v.valueCents)])} empty="No count differences in this period." /></Section>
    </div>
  );
}
