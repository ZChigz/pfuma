import { getAccess } from '@/lib/access';
import { fleet, VEHICLE_DOCS, DRIVER_DOCS, DOC_LABEL } from '@/lib/facilities/transport';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Section } from '@/components/finance/shared';
import { TransportNav } from '@/components/facilities/TransportNav';
import { JsonForm } from '@/components/facilities/JsonForm';

export const metadata = { title: 'Vehicles and drivers · Transport · Pfuma' };
const KEYS = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;
const TONE = { OK: 'success', SOON: 'warning', EXPIRED: 'danger', MISSING: 'danger' } as const;

function Papers({ papers }: { papers: { type: string; label: string; expiry: string | null; state: keyof typeof TONE; required: boolean }[] }) {
  return <p className="mt-1 flex flex-wrap gap-1">{papers.filter((p) => p.required || p.expiry).map((p) => <Badge key={p.type} variant={TONE[p.state]} label={`${p.label}: ${p.expiry ?? 'missing'}`} />)}</p>;
}

export default async function FleetPage() {
  const { user, can } = await getAccess();
  if (!KEYS.some((k) => can(k))) return <AccessDenied />;
  const manage = can('facilities.transport.manage');
  const f = await fleet(user);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Vehicles and drivers" description="Papers must be in date for a vehicle or driver to make a trip. You are told 30 days before they run out." />
      <TransportNav can={can} current="/facilities/transport/fleet" />
      <Section title="Vehicles">
        {f.vehicles.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="flex flex-col gap-2">{f.vehicles.map((v) => (
            <li key={v.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><b>{v.registration}</b>{v.blocked ? <Badge variant="danger" label="Cannot make trips" /> : <Badge variant="success" label="Ready" />}</p>
              <p className="text-xs text-muted">{v.make} {v.model ?? ''} · {v.seats} seats · {v.owner === 'HIRED' ? 'hired' : 'school'} · {v.odometerKm} km</p>
              <Papers papers={v.papers} />
            </li>
          ))}</ul>
        )}
      </Section>
      <Section title="Drivers">
        {f.drivers.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="flex flex-col gap-2">{f.drivers.map((d) => (
            <li key={d.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><b>{d.name}</b>{d.blocked ? <Badge variant="danger" label="Cannot drive" /> : <Badge variant="success" label="Ready" />}</p>
              <p className="text-xs text-muted">Licence class {d.licenceClass}{d.phone ? ` · ${d.phone}` : ''}</p>
              <Papers papers={d.papers} />
            </li>
          ))}</ul>
        )}
      </Section>
      {manage && (
        <>
          <Section title="Add a vehicle">
            <JsonForm url="/api/facilities/transport/vehicles" submit="Save vehicle" done="Vehicle saved" fields={[
              { name: 'registration', label: 'Registration', type: 'text', required: true }, { name: 'make', label: 'Make', type: 'text', required: true }, { name: 'model', label: 'Model', type: 'text' },
              { name: 'seats', label: 'Seats', type: 'number', required: true }, { name: 'owner', label: 'Owner', type: 'select', initial: 'SCHOOL', options: [{ value: 'SCHOOL', label: 'School' }, { value: 'HIRED', label: 'Hired' }] },
              { name: 'odometerKm', label: 'Odometer (km)', type: 'number', initial: '0' },
            ]} />
          </Section>
          {f.vehicles.length > 0 && (
            <Section title="Renew a vehicle paper">
              <p className="mb-2 text-xs text-muted">Choose the vehicle, then the paper and its new expiry date. The old paper stays as history.</p>
              {f.vehicles.map((v) => (
                <details key={v.id} className="mb-2 rounded-xl bg-white p-2">
                  <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">{v.registration}</summary>
                  <JsonForm url={`/api/facilities/transport/vehicles/${v.id}/documents`} submit="Save paper" done="Paper saved" fields={[
                    { name: 'type', label: 'Paper', type: 'select', required: true, options: VEHICLE_DOCS.map((t) => ({ value: t, label: DOC_LABEL[t]! })) },
                    { name: 'number', label: 'Number', type: 'text' }, { name: 'expiry', label: 'Valid until', type: 'date', required: true },
                  ]} />
                </details>
              ))}
            </Section>
          )}
          <Section title="Driver papers">
            {f.drivers.map((d) => (
              <details key={d.id} className="mb-2 rounded-xl bg-white p-2">
                <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">{d.name}</summary>
                <JsonForm url={`/api/facilities/transport/drivers/${d.id}/documents`} submit="Save paper" done="Paper saved" fields={[
                  { name: 'type', label: 'Paper', type: 'select', required: true, options: DRIVER_DOCS.map((t) => ({ value: t, label: DOC_LABEL[t]! })) },
                  { name: 'number', label: 'Number', type: 'text' }, { name: 'expiry', label: 'Valid until', type: 'date', required: true },
                ]} />
              </details>
            ))}
            <p className="mb-1 mt-3 text-sm font-semibold">Add a driver (from the staff list)</p>
            <JsonForm url="/api/facilities/transport/drivers" submit="Save driver" done="Driver saved" fields={[
              { name: 'employeeId', label: 'Staff member id (copy from HR)', type: 'text', required: true }, { name: 'licenceClass', label: 'Licence class', type: 'text', required: true },
              { name: 'licenceNumber', label: 'Licence number', type: 'text' }, { name: 'phone', label: 'Phone', type: 'text' },
            ]} />
          </Section>
        </>
      )}
    </div>
  );
}
