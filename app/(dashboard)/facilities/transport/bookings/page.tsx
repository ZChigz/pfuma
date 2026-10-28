import { getAccess } from '@/lib/access';
import { fleet, listBookings } from '@/lib/facilities/transport';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { TransportNav } from '@/components/facilities/TransportNav';
import { JsonForm } from '@/components/facilities/JsonForm';

export const metadata = { title: 'Bookings · Transport · Pfuma' };
const KEYS = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' });
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' } as const;

export default async function BookingsPage() {
  const { user, can } = await getAccess();
  if (!KEYS.some((k) => can(k))) return <AccessDenied />;
  const manage = can('facilities.transport.manage');
  const [rows, f] = await Promise.all([listBookings(user), fleet(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Vehicle bookings" description="School trips and sports fixtures. A vehicle or driver is never booked twice for the same time." />
      <TransportNav can={can} current="/facilities/transport/bookings" />
      <Section title="Bookings">
        {rows.length === 0 ? <p className="text-sm text-muted">None coming up.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((b) => (
            <li key={b.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><b>{b.purpose}</b><Badge variant={TONE[b.status as keyof typeof TONE] ?? 'neutral'} label={b.status.charAt(0) + b.status.slice(1).toLowerCase()} /></p>
              <p className="text-xs text-muted">{b.vehicle} · {when(b.startAt)} to {when(b.endAt)}{b.destination ? ` · ${b.destination}` : ''} · {b.learners} learners{b.perLearnerCents && b.currency ? ` · ${money(b.perLearnerCents, b.currency)} each` : ''} · asked by {b.requestedBy}</p>
              {manage && b.status === 'PENDING' && b.requestedById !== user.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <RowAction label="Approve" variant="primary" url={`/api/facilities/transport/bookings/${b.id}/decide`} body={{ decision: 'APPROVE' }} done="Approved" />
                  <RowAction label="Refuse" variant="ghost" url={`/api/facilities/transport/bookings/${b.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it refused?', min: 3 }} done="Refused" />
                </div>
              )}
              {manage && (b.status === 'PENDING' || b.status === 'APPROVED') && <div className="mt-2"><RowAction label="Cancel" variant="ghost" url={`/api/facilities/transport/bookings/${b.id}/decide`} body={{ decision: 'CANCEL' }} reason={{ label: 'Why is it cancelled?', min: 3 }} done="Cancelled" /></div>}
            </li>
          ))}</ul>
        )}
      </Section>
      {(manage || can('facilities.transport.trips')) && (
        <Section title="Book a vehicle">
          <JsonForm url="/api/facilities/transport/bookings" submit="Request booking" done="Booking requested" fields={[
            { name: 'vehicleId', label: 'Vehicle', type: 'select', required: true, options: f.vehicles.filter((v) => v.active).map((v) => ({ value: v.id, label: `${v.registration} (${v.seats} seats)` })) },
            { name: 'driverId', label: 'Driver', type: 'select', blank: 'No driver yet', options: f.drivers.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name })) },
            { name: 'startAt', label: 'Leaves', type: 'datetime', required: true }, { name: 'endAt', label: 'Back', type: 'datetime', required: true },
            { name: 'purpose', label: 'Purpose', type: 'text', required: true }, { name: 'destination', label: 'Destination', type: 'text' },
          ]} />
        </Section>
      )}
    </div>
  );
}
