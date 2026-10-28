import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { BED_TYPES, getHostel } from '@/lib/facilities/hostel';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Section } from '@/components/finance/shared';
import { HostelNav } from '@/components/facilities/HostelNav';
import { BedGrid } from '@/components/facilities/BedGrid';
import { AutoAllocate } from '@/components/facilities/AutoAllocate';

export const metadata = { title: 'Hostel · Pfuma' };

export default async function HostelDetailPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!['view', 'manage', 'allocate', 'rollcall', 'inspect'].some((k) => can(`facilities.hostel.${k}` as never))) return <AccessDenied />;
  const data = await getHostel(user, params.id).catch((e) => { if (e instanceof ServiceError && (e.status === 404 || e.status === 403)) return null; throw e; });
  if (!data) notFound();
  const { hostel: h, rooms } = data;
  const manage = can('facilities.hostel.manage');
  const allocate = can('facilities.hostel.allocate');
  const db = getScopedDb(user.schoolId, user.id);
  const [levels, classes] = allocate ? await Promise.all([db.level.findMany({ orderBy: { order: 'asc' }, select: { id: true, name: true } }), db.schoolClass.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })]) : [[], []];
  const filled = rooms.flatMap((r) => r.beds).filter((b) => b.studentId).length;
  const beds = rooms.flatMap((r) => r.beds).length;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={h.name} description={`${h.gender === 'M' ? 'Boys' : 'Girls'} · ${filled} of ${beds} beds filled${h.boardingMaster ? ` · boarding master ${h.boardingMaster}` : ''}${h.matron ? ` · matron ${h.matron}` : ''}`} breadcrumbs={[{ label: 'Hostel', href: '/facilities/hostel' }, { label: h.name }]}
        actions={(
          <div className="flex flex-wrap gap-2">
            {allocate && <AutoAllocate hostelId={h.id} levels={levels} classes={classes} />}
            {manage && <FormAction label="Add a room" size="md" url="/api/facilities/hostel/rooms" done="Room added" extra={{ hostelId: h.id }} fields={[{ name: 'name', label: 'Room name', required: true }, { name: 'floor', label: 'Floor' }, { name: 'capacity', label: 'Capacity', type: 'number', initial: '0' }]} />}
            {manage && rooms.length > 0 && <FormAction label="Add beds" size="md" url="/api/facilities/hostel/beds" done="Beds added" intro="Say how many and they are numbered after the beds already in the room." fields={[
              { name: 'roomId', label: 'Room', type: 'select', required: true, options: rooms.map((r) => ({ value: r.id, label: r.name })) }, { name: 'count', label: 'How many beds', type: 'number', required: true, initial: '4' },
              { name: 'bedType', label: 'Kind', type: 'select', initial: 'SINGLE', options: BED_TYPES.map((b) => ({ value: b, label: b === 'SINGLE' ? 'Single' : b === 'BUNK_TOP' ? 'Bunk, top' : 'Bunk, bottom' })) }, { name: 'lockerPrefix', label: 'Locker number starts with', hint: 'For example L gives L1, L2' }]} />}
            {can('facilities.hostel.view') && can('students.guardians.view') && <Link className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint" href={`/facilities/hostel/${h.id}/print`}>Room list</Link>}
          </div>
        )} />
      <HostelNav can={can} current="/facilities/hostel" />
      <Section title="Rooms and beds" hint={allocate ? 'Tap a bed to give it to a boarder or release it.' : undefined}>
        {rooms.length === 0 ? <p className="text-sm text-muted">No rooms yet.</p> : <BedGrid rooms={rooms} canAllocate={allocate} />}
      </Section>
    </div>
  );
}
