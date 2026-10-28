import { getAccess } from '@/lib/access';
import { assetReports } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section, Td, Th } from '@/components/finance/shared';
import { AssetNav } from '@/components/facilities/AssetNav';

export const metadata = { title: 'Asset reports · Pfuma' };
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const zig = (c: number) => `ZiG ${(c / 100).toFixed(2)}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

type Group = { name: string; count: number; usdCostCents: number; zigCostCents: number; usdBookCents: number; zigBookCents: number };
function GroupTable({ rows, first }: { rows: Group[]; first: string }) {
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[34rem]"><thead><tr><Th>{first}</Th><Th className="text-right">Assets</Th><Th className="text-right">Cost (USD)</Th><Th className="text-right">Book (USD)</Th><Th className="text-right">Cost (ZiG)</Th><Th className="text-right">Book (ZiG)</Th></tr></thead><tbody>
      {rows.map((g) => <tr key={g.name} className="border-t border-line"><Td>{g.name}</Td><Td className="text-right">{g.count}</Td><Td className="text-right">{usd(g.usdCostCents)}</Td><Td className="text-right">{usd(g.usdBookCents)}</Td><Td className="text-right">{zig(g.zigCostCents)}</Td><Td className="text-right">{zig(g.zigBookCents)}</Td></tr>)}
    </tbody></table></div>
  );
}

export default async function AssetReportsPage() {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'maintain', 'dispose', 'verify'].some((k) => can(`facilities.assets.${k}` as never))) return <AccessDenied />;
  const r = await assetReports(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Asset reports" description="Dollars and ZiG are never added together. Book value is cost less straight-line depreciation by category." />
      <AssetNav can={can} current="/facilities/assets/reports" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([['Assets', String(r.total.count)], ['Cost (USD)', usd(r.total.usdCostCents)], ['Book value (USD)', usd(r.total.usdBookCents)], ['Cost / book (ZiG)', `${zig(r.total.zigCostCents)} / ${zig(r.total.zigBookCents)}`]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-white p-3"><p className="text-xs text-muted">{k}</p><p className="text-lg font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      <Section title="By category"><GroupTable rows={r.byCategory} first="Category" /></Section>
      <Section title="By place"><GroupTable rows={r.byLocation} first="Place" /></Section>
      <Section title="By custodian"><GroupTable rows={r.byCustodian} first="Custodian" /></Section>
      <Section title="Due for service">
        {r.dueForService.length === 0 ? <p className="text-sm text-muted">Nothing is due.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[28rem]"><thead><tr><Th>Asset</Th><Th>Service</Th><Th>Due</Th><Th /></tr></thead><tbody>
            {r.dueForService.map((d) => <tr key={d.scheduleId} className="border-t border-line"><Td><span className="font-mono">{d.tag}</span> {d.asset}</Td><Td>{d.title}</Td><Td>{d.nextDueAt ?? `${d.nextDueKm} km`}</Td><Td>{d.overdue && <Badge variant="danger" label="Overdue" />}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Maintenance cost per asset">
        {r.maintenanceCost.length === 0 ? <p className="text-sm text-muted">No costs recorded.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[28rem]"><thead><tr><Th>Asset</Th><Th className="text-right">Jobs</Th><Th className="text-right">USD</Th><Th className="text-right">ZiG</Th></tr></thead><tbody>
            {r.maintenanceCost.map((m) => <tr key={m.assetId} className="border-t border-line"><Td><span className="font-mono">{m.tag}</span> {m.asset}</Td><Td className="text-right">{m.jobs}</Td><Td className="text-right">{usd(m.usdCents)}</Td><Td className="text-right">{zig(m.zigCents)}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
      <Section title="Disposals">
        {r.disposals.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[30rem]"><thead><tr><Th>Asset</Th><Th>How</Th><Th>Date</Th><Th>Why</Th><Th className="text-right">Money received</Th></tr></thead><tbody>
            {r.disposals.map((d, i) => <tr key={i} className="border-t border-line"><Td><span className="font-mono">{d.tag}</span> {d.asset}</Td><Td>{label(d.method)}</Td><Td>{d.date}</Td><Td>{d.reason}</Td><Td className="text-right">{d.proceedsCents ? (d.currency === 'ZIG' ? zig(d.proceedsCents) : usd(d.proceedsCents)) : '—'}</Td></tr>)}
          </tbody></table></div>
        )}
      </Section>
      {r.warrantyEnding.length > 0 && <Section title="Warranty ending within 60 days"><ul className="text-sm">{r.warrantyEnding.map((w) => <li key={w.tag}><span className="font-mono">{w.tag}</span> {w.asset}: {w.warrantyEnd}</li>)}</ul></Section>}
    </div>
  );
}
