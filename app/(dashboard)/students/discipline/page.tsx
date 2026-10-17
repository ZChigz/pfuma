import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { disciplineReport, pendingDecisions } from '@/lib/students/discipline';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { DisciplineClient } from '@/components/students/DisciplineClient';

export const metadata = { title: 'Discipline · Pfuma' };

export default async function DisciplinePage() {
  const { user, can } = await getAccess();
  // Anyone who may record incidents may open the page to do so; the reports need students.discipline.view.
  if (!can('students.discipline.view') && !can('students.discipline.create')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const canView = can('students.discipline.view');
  const [report, pending, term] = await Promise.all([
    canView ? disciplineReport(user) : Promise.resolve({ byCategory: [], byClass: [], byMonth: [], repeaters: [], openSuspensions: [] }),
    can('students.discipline.approve') ? pendingDecisions(user) : Promise.resolve([]),
    db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { name: true } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Discipline" description="Record incidents, decide suspensions, and see who needs attention." breadcrumbs={[{ label: 'Student Information' }, { label: 'Discipline' }]} />
      <DisciplineClient report={report} pending={pending} canRecord={can('students.discipline.create')} canApprove={can('students.discipline.approve')} termName={term?.name ?? null} />
    </div>
  );
}
