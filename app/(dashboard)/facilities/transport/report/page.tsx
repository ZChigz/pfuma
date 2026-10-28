import { getAccess } from '@/lib/access';
import { transportReport } from '@/lib/facilities/transport';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/finance/shared';
import { TransportNav } from '@/components/facilities/TransportNav';

export const metadata = { title: 'Report · Transport · Pfuma' };
const KEYS = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export default async function ReportPage() {
  const { user, can } = await getAccess();
  if (!KEYS.some((k) => can(k))) return <AccessDenied />;
  const r = await transportReport(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Transport report" description={`${r.from} to ${r.to}: kilometres, fuel and cost per kilometre for each vehicle. Each currency on its own.`} />
      <TransportNav can={can} current="/facilities/transport/report" />
      <Section title="By vehicle">
        {r.perVehicle.length === 0 ? <p className="text-sm text-muted">No vehicles yet.</p> : (
          <ul className="flex flex-col gap-2">{r.perVehicle.map((v) => (
            <li key={v.vehicleId} className="rounded-xl border border-line bg-white p-3 text-sm">
              <b>{v.registration}</b> <span className="text-muted">· {v.trips} trips · {v.km} km · {v.litres} litres{v.kmPerLitre ? ` · ${v.kmPerLitre} km per litre` : ''}</span>
              {v.fuelCost.length > 0 && <p className="text-xs text-muted">Fuel {v.fuelCost.map((c) => money(c.cents, c.currency)).join(' and ')}{v.costPerKm.filter((c) => c.cents !== null).map((c) => ` · ${money(c.cents!, c.currency)} per km`).join('')}</p>}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
