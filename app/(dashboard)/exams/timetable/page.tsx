import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { listTypes } from '@/lib/exams/setup';
import { myDuties } from '@/lib/exams/invigilation';
import { listPeriods } from '@/lib/exams/timetable';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodsClient } from '@/components/exams/PeriodsClient';

export const metadata = { title: 'Exam timetable · Pfuma' };

export default async function ExamTimetablePage() {
  const { user, can } = await getAccess();
  const staff = can('exams.timetable.manage') || can('exams.timetable.approve') || can('exams.invigilation.manage');
  if (!staff && !can('exams.marks.enter')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Exam timetable" description="Exam periods, their papers, invigilation duties and seating." breadcrumbs={[{ label: 'Examinations', href: '/exams' }, { label: 'Timetable' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [periods, duties, types, levels] = await Promise.all([
    listPeriods(user, term.id),
    can('exams.marks.enter') ? myDuties(user) : Promise.resolve([]),
    can('exams.timetable.manage') ? listTypes(user) : Promise.resolve([]),
    db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <PeriodsClient
        termId={term.id} termName={term.name} periods={periods} duties={duties} levels={levels} types={types.filter((t) => t.active && !t.isProject).map((t) => ({ id: t.id, name: t.name }))}
        canManage={can('exams.timetable.manage')}
      />
    </div>
  );
}
