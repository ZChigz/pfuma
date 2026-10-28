import { getAccess } from '@/lib/access';
import { fleet, listRoutes } from '@/lib/facilities/transport';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section } from '@/components/finance/shared';
import { TransportNav } from '@/components/facilities/TransportNav';
import { JsonForm } from '@/components/facilities/JsonForm';
import { AssignRoute } from '@/components/facilities/AssignRoute';

export const metadata = { title: 'Transport · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const KEYS = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;

export default async function TransportPage() {
  const { user, can } = await getAccess();
  if (!KEYS.some((k) => can(k))) return <AccessDenied />;
  const manage = can('facilities.transport.manage');
  const [routes, f] = await Promise.all([listRoutes(user), fleet(user)]);
  const routeOptions = routes.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, feeText: money(r.feeCents, r.currency), stops: r.stops.map((s) => ({ id: s.id, name: s.name })) }));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Transport" description="Routes, stops and the learners on them. A learner on a route is charged each term." />
      <TransportNav can={can} current="/facilities/transport" />
      <Section title="Routes">
        {routes.length === 0 ? <p className="text-sm text-muted">No routes yet.</p> : (
          <ul className="flex flex-col gap-2">{routes.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><b>{r.name}</b>{r.seats !== null && <Badge variant={r.learners >= r.seats ? 'danger' : 'neutral'} label={`${r.learners} of ${r.seats} seats`} />}</p>
              <p className="text-xs text-muted">{r.zone ? `${r.zone} · ` : ''}{money(r.feeCents, r.currency)} a term · {r.amTime ?? '--'} / {r.pmTime ?? '--'} · {r.vehicle ?? 'no vehicle'} · {r.driver ?? 'no driver'}</p>
              {r.stops.length > 0 && <p className="mt-1 text-xs">{r.stops.map((s) => `${s.sequence}. ${s.name}`).join(' → ')}</p>}
            </li>
          ))}</ul>
        )}
      </Section>
      {can('facilities.transport.assign') && <Section title="Put a learner on a route"><AssignRoute routes={routeOptions} /></Section>}
      {manage && (
        <>
          <Section title="Add or change a route">
            <JsonForm url="/api/facilities/transport/routes" submit="Save route" done="Route saved" fields={[
              { name: 'name', label: 'Route name', type: 'text', required: true }, { name: 'zone', label: 'Zone', type: 'text' },
              { name: 'amTime', label: 'Morning departure', type: 'time' }, { name: 'pmTime', label: 'Afternoon departure', type: 'time' },
              { name: 'feeCents', label: 'Fee per term', type: 'cents', required: true, initial: '0' },
              { name: 'currency', label: 'Currency', type: 'select', initial: 'USD', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] },
              { name: 'vehicleId', label: 'Vehicle', type: 'select', blank: 'No vehicle', options: f.vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: `${v.registration} (${v.seats} seats)` })) },
              { name: 'driverId', label: 'Driver', type: 'select', blank: 'No driver', options: f.drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name })) },
            ]} />
          </Section>
          {routes.length > 0 && (
            <Section title="Add a stop">
              <JsonForm url="/api/facilities/transport/stops" submit="Save stop" done="Stop saved" fields={[
                { name: 'routeId', label: 'Route', type: 'select', required: true, options: routes.map((r) => ({ value: r.id, label: r.name })) },
                { name: 'name', label: 'Stop', type: 'text', required: true }, { name: 'sequence', label: 'Order on the route (1, 2, 3 ...)', type: 'number', required: true },
                { name: 'amPickupTime', label: 'Morning pick-up', type: 'time' }, { name: 'pmDropTime', label: 'Afternoon drop', type: 'time' },
              ]} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
