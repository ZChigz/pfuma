import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { reachableClassIds } from '@/lib/academics/common';
import { studentSubjectGrid, syncCoreSubjects } from '@/lib/academics/student-subjects';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { StudentSubjectsClient } from '@/components/academics/StudentSubjectsClient';

export const metadata = { title: 'Student subjects · Pfuma' };

export default async function StudentSubjectsPage({ searchParams }: { searchParams: { classId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.classes.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const manage = can('academics.student_subjects.manage');
  const reach = term ? await db.$tx((tx) => reachableClassIds(tx, user, term.id)) : [];
  const classes = await db.schoolClass.findMany({
    where: { active: true, level: { active: true }, ...(reach === 'all' ? {} : { id: { in: reach } }) },
    orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true },
  });
  let grid = null;
  if (term && searchParams.classId) {
    // Core subjects follow the form automatically; open the page and they are there.
    if (manage && term.status !== 'CLOSED') await syncCoreSubjects(user, term.id, searchParams.classId).catch(() => null);
    try { grid = await studentSubjectGrid(user, searchParams.classId, term.id); } catch (err) { if (!(err instanceof ServiceError)) throw err; }
  }
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Student subjects" description="Which subjects each student takes this term. Core subjects come from the form; electives are chosen here." breadcrumbs={[{ label: 'Academics' }, { label: 'Student subjects' }]} />
      <StudentSubjectsClient classes={classes} classId={grid ? searchParams.classId ?? null : null} grid={grid} canManage={manage} />
    </div>
  );
}
