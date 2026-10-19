import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listCombinations } from '@/lib/academics/student-subjects';
import { listDepartments, listSubjectChanges, listSubjects } from '@/lib/academics/subjects';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { SubjectsClient } from '@/components/academics/SubjectsClient';

export const metadata = { title: 'Subjects · Pfuma' };

export default async function SubjectsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.subjects.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const manage = can('academics.subjects.manage');
  const [list, departments, combinations, changes, classes, staff, school] = await Promise.all([
    listSubjects(user),
    listDepartments(user),
    listCombinations(user),
    listSubjectChanges(user, 'ALL'),
    db.schoolClass.findMany({ where: { active: true, level: { active: true } }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, levelId: true } }),
    manage ? db.user.findMany({ where: { active: true, isSupport: false }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : Promise.resolve([]),
    db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { offersCambridge: true } }),
  ]);
  const tab = (['subjects', 'departments', 'combinations', 'approvals'] as const).find((t) => t === searchParams.tab);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Subjects" description="The school's own list of subjects, grouped into departments. Nothing here is fixed: edit it when the curriculum changes." breadcrumbs={[{ label: 'Academics' }, { label: 'Subjects' }]} />
      <SubjectsClient
        levels={list.levels} subjects={list.subjects} departments={departments} combinations={combinations} classes={classes} changes={changes} staff={staff}
        flags={{ manage, approve: can('academics.subjects.approve'), offersCambridge: school.offersCambridge }} initialTab={tab}
      />
    </div>
  );
}
