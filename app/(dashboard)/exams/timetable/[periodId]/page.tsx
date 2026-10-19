import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { dutyRoster, listIncidents } from '@/lib/exams/invigilation';
import { getPeriod } from '@/lib/exams/timetable';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodClient } from '@/components/exams/PeriodClient';

export const metadata = { title: 'Exam period · Pfuma' };

export default async function PeriodPage({ params }: { params: { periodId: string } }) {
  const { user, can } = await getAccess();
  const staff = can('exams.timetable.manage') || can('exams.timetable.approve') || can('exams.invigilation.manage');
  if (!staff && !can('exams.marks.enter')) return <AccessDenied />;
  try {
    const detail = await getPeriod(user, params.periodId);
    const db = getScopedDb(user.schoolId, user.id);
    const [subjects, rooms, roster, incidents] = await Promise.all([
      db.subject.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      db.room.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, capacity: true } }),
      staff ? dutyRoster(user, params.periodId) : Promise.resolve(null),
      staff ? listIncidents(user, params.periodId) : Promise.resolve([]),
    ]);
    return (
      <div className="flex flex-col gap-4 pb-8">
        <PageHeader
          title={detail.period.name} description={`${detail.period.startDate} to ${detail.period.endDate} · ${detail.period.levels.map((l) => l.name).join(', ')} · marks feed ${detail.period.typeName}`}
          breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Timetable', href: '/exams/timetable' }, { label: detail.period.name }]}
        />
        <PeriodClient
          detail={detail} subjects={subjects} rooms={rooms} roster={roster} incidents={incidents} currentUserId={user.id}
          flags={{ manage: can('exams.timetable.manage'), approve: can('exams.timetable.approve'), invigilation: can('exams.invigilation.manage') || can('exams.timetable.manage') }}
        />
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <EmptyState title="This exam period is not available" description={err.message} cta={{ label: 'Exam timetable', href: '/exams/timetable' }} />;
    throw err;
  }
}
