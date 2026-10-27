import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { SESSION_LABEL, hostelDashboard } from '@/lib/facilities/hostel';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Section } from '@/components/finance/shared';
import { HostelNav } from '@/components/facilities/HostelNav';

export const metadata = { title: 'Hostel · Pfuma' };

export default async function HostelPage() {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'allocate', 'rollcall', 'inspect'].some((k) => can(`facilities.hostel.${k}` as never))) return <AccessDenied />;
  const d = await hostelDashboard(user);
  const staff = can('facilities.hostel.manage') ? await getScopedDb(user.schoolId, user.id).user.findMany({ where: { active: true, isSupport: false }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : [];
  const people = staff.map((s) => ({ value: s.id, label: s.fullName }));
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Hostel" description="Beds, roll call and inspections. A boarding master sees only their own hostel."
        actions={can('facilities.hostel.manage') && (
          <FormAction label="Add a hostel" size="md" variant="primary" url="/api/facilities/hostel" done="Hostel added"
            fields={[{ name: 'name', label: 'Name', required: true }, { name: 'gender', label: 'For', type: 'select', required: true, options: [{ value: 'M', label: 'Boys' }, { value: 'F', label: 'Girls' }] },
              { name: 'boardingMasterId', label: 'Boarding master', type: 'select', options: people }, { name: 'matronId', label: 'Matron', type: 'select', options: people }, { name: 'capacity', label: 'Capacity', type: 'number', initial: '0' }]} />
        )} />
      <HostelNav can={can} current="/facilities/hostel" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([['Beds filled', `${d.beds.filled} of ${d.beds.total}`], ['Capacity', String(d.beds.capacity)], ['On exeat', String(d.onExeat)], ['In sick bay', String(d.inSickBay)], ['Overdue returns', String(d.overdueReturns)]] as const).map(([k, v]) => (
          <div key={k} className={`rounded-xl border bg-white p-3 ${k === 'Overdue returns' && d.overdueReturns > 0 ? 'border-danger' : 'border-line'}`}><p className="text-xs text-muted">{k}</p><p className="text-xl font-semibold text-ink">{v}</p></div>
        ))}
      </div>
      <Section title="Tonight's roll call">
        {d.rollCalls.length === 0 ? <p className="text-sm text-muted">No hostels yet.</p> : (
          <ul className="flex flex-col gap-2">{d.rollCalls.map((h) => (
            <li key={h.hostelId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3 text-sm">
              <Link className="font-semibold text-primary underline" href={`/facilities/hostel/${h.hostelId}`}>{h.hostel}</Link>
              <span className="flex flex-wrap gap-2">{h.sessions.map((s) => (
                <Link key={s.session} href={`/facilities/hostel/rollcall/${h.hostelId}?session=${s.session}`} className="inline-flex min-h-[40px] items-center gap-1">
                  <Badge variant={s.taken ? 'success' : 'warning'} label={`${SESSION_LABEL[s.session as keyof typeof SESSION_LABEL]}: ${s.taken ? `${s.absent} absent` : 'not taken'}`} />
                </Link>))}</span>
            </li>
          ))}</ul>
        )}
      </Section>
      <Section title="Hostels">
        {d.hostels.length === 0 ? <p className="text-sm text-muted">Add the first hostel, then its rooms and beds.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">{d.hostels.map((h) => (
            <Link key={h.id} href={`/facilities/hostel/${h.id}`} className="rounded-xl border border-line bg-white p-4 hover:bg-tint">
              <p className="text-base font-semibold text-ink">{h.name} <span className="text-xs font-normal text-muted">· {h.gender === 'M' ? 'boys' : 'girls'}</span></p>
              <p className="mt-1 text-sm text-muted">{h.filled} of {h.beds} beds filled · {h.free} free · {h.rooms} rooms</p>
              <p className="text-xs text-muted">{h.boardingMaster ? `Boarding master ${h.boardingMaster}` : 'No boarding master yet'}{h.matron ? ` · matron ${h.matron}` : ''}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full bg-primary" style={{ width: `${h.beds ? Math.round((h.filled / h.beds) * 100) : 0}%` }} /></div>
            </Link>
          ))}</div>
        )}
      </Section>
    </div>
  );
}
