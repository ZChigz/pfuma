import { getAccess } from '@/lib/access';
import { fleet, listRoutes, recentTrips } from '@/lib/facilities/transport';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section } from '@/components/finance/shared';
import { TransportNav } from '@/components/facilities/TransportNav';
import { JsonForm } from '@/components/facilities/JsonForm';

export const metadata = { title: 'Trips and fuel · Transport · Pfuma' };
const KEYS = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;

export default async function TripsPage() {
  const { user, can } = await getAccess();
  if (!KEYS.some((k) => can(k))) return <AccessDenied />;
  const record = can('facilities.transport.trips');
  const [trips, routes, f] = await Promise.all([recentTrips(user), listRoutes(user), fleet(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Trips and fuel" description="Record each run. A vehicle or driver whose papers have run out cannot be used." />
      <TransportNav can={can} current="/facilities/transport/trips" />
      {record && (
        <>
          <Section title="Record a trip">
            <JsonForm url="/api/facilities/transport/trips" submit="Record trip" done="Trip recorded" fields={[
              { name: 'routeId', label: 'Route', type: 'select', required: true, options: routes.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name })) },
              { name: 'leg', label: 'Leg', type: 'select', initial: 'MORNING', options: [{ value: 'MORNING', label: 'Morning' }, { value: 'AFTERNOON', label: 'Afternoon' }, { value: 'OTHER', label: 'Other' }] },
              { name: 'vehicleId', label: 'Vehicle (the route\'s if empty)', type: 'select', blank: 'The route\'s vehicle', options: f.vehicles.map((v) => ({ value: v.id, label: `${v.registration}${v.blocked ? ' (papers out of date)' : ''}` })) },
              { name: 'driverId', label: 'Driver (the route\'s if empty)', type: 'select', blank: 'The route\'s driver', options: f.drivers.map((d) => ({ value: d.id, label: `${d.name}${d.blocked ? ' (papers out of date)' : ''}` })) },
              { name: 'odometerStart', label: 'Odometer at the start (km)', type: 'number' }, { name: 'odometerEnd', label: 'Odometer at the end (km)', type: 'number' },
            ]} />
          </Section>
          <Section title="Log fuel">
            <JsonForm url="/api/facilities/transport/fuel" submit="Save fuel" done="Fuel recorded" fields={[
              { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, options: f.vehicles.map((v) => ({ value: v.id, label: v.registration })) },
              { name: 'litres', label: 'Litres', type: 'number', required: true }, { name: 'costCents', label: 'Cost', type: 'cents', required: true },
              { name: 'currency', label: 'Currency', type: 'select', initial: 'USD', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] },
              { name: 'odometerKm', label: 'Odometer (km)', type: 'number' },
            ]} />
          </Section>
        </>
      )}
      <Section title="Last two weeks">
        {trips.length === 0 ? <p className="text-sm text-muted">No trips recorded.</p> : (
          <ul className="flex flex-col gap-2">{trips.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <span><b>{t.date}</b> · {t.route} · {t.vehicle}<br /><span className="text-muted">{t.leg.toLowerCase()}{t.km !== null ? ` · ${t.km} km` : ''}</span></span>
              <Badge variant="neutral" label={`${t.boarded} on board`} />
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
