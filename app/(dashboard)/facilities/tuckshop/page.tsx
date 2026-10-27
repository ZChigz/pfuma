import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { tuckItems, todaysSales } from '@/lib/facilities/tuckshop';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/finance/shared';
import { TuckNav } from '@/components/facilities/TuckNav';
import { TuckPos } from '@/components/facilities/TuckPos';

export const metadata = { title: 'Tuck shop · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function TuckShopPage() {
  const { user, can } = await getAccess();
  const sell = can('facilities.tuckshop.sell');
  if (!sell && !can('facilities.tuckshop.cashup') && !can('facilities.wallets.manage') && !can('facilities.wallets.view')) return <AccessDenied />;
  const [items, today] = await Promise.all([sell ? tuckItems(user) : Promise.resolve([]), sell || can('facilities.tuckshop.cashup') ? todaysSales(user) : Promise.resolve(null)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Tuck shop" description="Sell from the Tuck shop store in cash or from a boarder's pocket money." />
      <TuckNav can={can} current="/facilities/tuckshop" />
      {sell ? <TuckPos items={items.map((i) => ({ itemId: i.itemId, name: i.name, size: i.size, qty: i.qty, priceCents: i.priceCents, priceCurrency: i.priceCurrency }))} />
        : <p className="text-sm text-muted">You do not sell at the till. Open <Link className="underline" href="/facilities/tuckshop/wallets">Pocket money</Link>.</p>}
      {today && (
        <Section title="Today">
          {today.sales.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : (
            <>
              <p className="mb-2 text-sm">{today.totals.map((t) => `${money(t.cashCents, t.currency)} cash, ${money(t.walletCents, t.currency)} from wallets`).join(' · ')}</p>
              <ul className="flex flex-col gap-1 text-sm">{today.sales.slice(0, 30).map((s) => <li key={s.id} className="rounded-lg bg-white p-2">{new Date(s.soldAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' })} · {money(s.totalCents, s.currency)} · {s.payment === 'WALLET' ? s.student : 'cash'} <span className="text-muted">· {s.lines}</span></li>)}</ul>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
