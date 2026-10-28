import { getAccess } from '@/lib/access';
import { listCashUps, todaysSales } from '@/lib/facilities/tuckshop';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { TuckNav } from '@/components/facilities/TuckNav';
import { CashUpForm } from '@/components/facilities/CashUpForm';

export const metadata = { title: 'Cash-up · Tuck shop · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function CashUpPage() {
  const { user, can } = await getAccess();
  const sell = can('facilities.tuckshop.sell');
  const confirm = can('facilities.tuckshop.cashup');
  if (!sell && !confirm) return <AccessDenied />;
  const [today, rows] = await Promise.all([sell ? todaysSales(user) : Promise.resolve(null), listCashUps(user)]);
  const mine = today?.sales.filter((s) => s.payment === 'CASH' && !s.cashUpId) ?? [];
  const expected = (['USD', 'ZIG'] as const).map((currency) => ({ currency, cents: mine.filter((s) => s.currency === currency).reduce((a, s) => a + s.totalCents, 0) }));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Cash-up" description="Count the cash at the end of the day. Someone else confirms it." />
      <TuckNav can={can} current="/facilities/tuckshop/cashup" />
      {sell && <Section title="Cash up today"><CashUpForm expected={expected} /></Section>}
      <Section title="Cash-ups">
        {rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{r.date}</b> · {r.attendant}<br /><span className="text-muted">Expected {money(r.expectedCents, r.currency)}, counted {money(r.countedCents, r.currency)}{r.differenceCents ? `, difference ${money(r.differenceCents, r.currency)}` : ''}{r.note ? ` · ${r.note}` : ''}</span></span>
              {r.confirmed ? <Badge variant="success" label="Confirmed" /> : confirm && r.attendantId !== user.id ? <RowAction label="Confirm" variant="primary" url={`/api/facilities/tuckshop/cashup/${r.id}/confirm`} body={{}} done="Confirmed" /> : <Badge variant="warning" label="Waiting" />}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
