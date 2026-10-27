import { getAccess } from '@/lib/access';
import { getHostel, listHostels, listInspections } from '@/lib/facilities/hostel';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { RowAction, Section } from '@/components/finance/shared';
import { HostelNav } from '@/components/facilities/HostelNav';
import { InspectionForm } from '@/components/facilities/InspectionForm';

export const metadata = { title: 'Inspections · Hostel · Pfuma' };
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const NICE: Record<string, string> = { CLEANLINESS: 'Cleanliness', BEDS_MADE: 'Beds made', LOCKERS: 'Lockers', DAMAGE: 'Damage' };

export default async function InspectionsPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.hostel.inspect') && !can('facilities.hostel.manage') && !can('facilities.hostel.view')) return <AccessDenied />;
  const [rows, hostels] = await Promise.all([listInspections(user), can('facilities.hostel.inspect') ? listHostels(user) : Promise.resolve([])]);
  const withRooms = await Promise.all(hostels.filter((h) => h.active).map(async (h) => ({ id: h.id, name: h.name, rooms: (await getHostel(user, h.id)).rooms.map((r) => ({ id: r.id, name: r.name })) })));
  const decide = can('facilities.hostel.manage');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Room inspections" description="A checklist per room: cleanliness, beds made, lockers and damage. Damage becomes a charge to the learner only when the boarding master approves." />
      <HostelNav can={can} current="/facilities/hostel/inspections" />
      {withRooms.length > 0 && <InspectionForm hostels={withRooms} />}
      <Section title="Recent inspections">
        {rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="flex flex-col gap-2">{rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-white p-3 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-ink">{r.hostel}, {r.room} <span className="font-normal text-muted">· {r.date} · {r.inspector}</span></span><Badge variant={r.score >= 70 ? 'success' : r.score >= 40 ? 'warning' : 'danger'} label={`${r.score} out of 100`} /></p>
              <p className="text-xs text-muted">{r.items.map((i) => `${NICE[i.item] ?? i.item} ${i.score}/5`).join(' · ')}{r.photos ? ` · ${r.photos} photo${r.photos === 1 ? '' : 's'}` : ''}</p>
              {r.notes && <p className="mt-1">{r.notes}</p>}
              {r.items.filter((i) => i.damageStatus).map((i) => (
                <div key={i.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas p-2">
                  <span>Damage{i.note ? `: ${i.note}` : ''} · {i.learner} · {money(i.damageCents ?? 0, i.damageCurrency ?? 'USD')}</span>
                  {i.damageStatus === 'PENDING' ? (decide ? (
                    <span className="flex gap-2"><RowAction label="Charge" variant="primary" url={`/api/facilities/hostel/inspections/items/${i.id}/decide`} body={{ decision: 'APPROVE' }} done="Charged to the learner" />
                      <RowAction label="Do not charge" variant="ghost" url={`/api/facilities/hostel/inspections/items/${i.id}/decide`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it not charged?', min: 3 }} done="Not charged" /></span>
                  ) : <Badge variant="warning" label="Waiting for the boarding master" />) : <Badge variant={i.damageStatus === 'APPROVED' ? 'success' : 'neutral'} label={i.damageStatus === 'APPROVED' ? 'Charged' : 'Not charged'} />}
                </div>
              ))}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}
