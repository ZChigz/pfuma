import { getAccess } from '@/lib/access';
import { listWallets, trustCheck } from '@/lib/facilities/tuckshop';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section } from '@/components/finance/shared';
import { TuckNav } from '@/components/facilities/TuckNav';
import { WalletDesk } from '@/components/facilities/WalletDesk';

export const metadata = { title: 'Pocket money · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function WalletsPage({ searchParams }: { searchParams: { q?: string; low?: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.wallets.manage') && !can('facilities.wallets.view')) return <AccessDenied />;
  const [rows, trust] = await Promise.all([listWallets(user, { q: searchParams.q, lowOnly: searchParams.low === '1' }), trustCheck(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Pocket money" description="Held in trust in its own fund. It is never used against school fees." />
      <TuckNav can={can} current="/facilities/tuckshop/wallets" />
      {trust.map((t) => (
        <div key={t.currency} className={`rounded-xl p-3 text-sm ${t.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
          {t.currency}: wallets hold {money(t.walletsCents, t.currency)}{t.fundReceivedCents !== null ? `. Paid into the pocket money fund: ${money(t.fundReceivedCents, t.currency)}, put in wallets: ${money(t.financeDepositsCents, t.currency)}${t.ok ? '. Matches.' : `. ${money(Math.abs(t.unmatchedCents ?? 0), t.currency)} paid into the fund is not in any wallet.`}` : '.'}
        </div>
      ))}
      {can('facilities.wallets.manage') && <Section title="Pay in, hand back or change"><WalletDesk /></Section>}
      <Section title={`Wallets (${rows.length})`}>
        {rows.length === 0 ? <p className="text-sm text-muted">No wallets yet. A wallet is made when pocket money is first paid in.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.walletId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{r.student}</b> <span className="text-muted">· {r.className ?? r.admissionNumber}{r.weeklyLimitCents != null ? ` · limit ${money(r.weeklyLimitCents, r.currency)}/week, ${money(r.spentThisWeekCents, r.currency)} spent` : ''}</span></span>
              <span className="flex items-center gap-2"><b>{money(r.balanceCents, r.currency)}</b>{r.closed ? <Badge variant="neutral" label="Closed" /> : r.low ? <Badge variant="warning" label="Low" /> : null}</span>
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
