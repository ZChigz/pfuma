import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { applicableSchedule, getAvailability, getBell, listRooms } from '@/lib/academics/bell';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { TimetableSetupClient } from '@/components/academics/TimetableSetupClient';

export const metadata = { title: 'Periods and rooms · Pfuma' };

export default async function TimetableSetupPage({ searchParams }: { searchParams: { teacherId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.edit')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Periods and rooms" description="The bell schedule, the rooms, and when each teacher is free." breadcrumbs={[{ label: 'Academics' }, { label: 'Timetable', href: '/academics/timetable' }, { label: 'Periods and rooms' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;

  const [bell, rooms, teachers, schedule] = await Promise.all([
    getBell(user, term.id),
    listRooms(user),
    db.user.findMany({ where: { active: true, isSupport: false, userRoles: { some: { role: { key: 'TEACHER' } } } }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
    db.$tx((tx) => applicableSchedule(tx, term.id)),
  ]);
  const periods = schedule ? await db.period.findMany({ where: { scheduleId: schedule.id }, select: { id: true, dayOfWeek: true, periodNo: true, start: true, type: true } }) : [];
  const avail = searchParams.teacherId ? await getAvailability(user, searchParams.teacherId, term.id).catch(() => null) : null;
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <TimetableSetupClient
        key={`${bell.bell.id}-${bell.bell.days.length}-${searchParams.teacherId ?? ''}`}
        term={bell.term} bell={bell.bell} scope={bell.bell.scope} hasTermSchedule={bell.hasTermSchedule} inUse={bell.inUse} rooms={rooms} teachers={teachers}
        unavailable={avail?.unavailable ?? []} selectedTeacher={avail ? searchParams.teacherId ?? null : null} periodsForAvailability={periods}
      />
    </div>
  );
}
