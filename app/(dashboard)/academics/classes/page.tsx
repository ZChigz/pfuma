import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listClasses } from '@/lib/academics/classes';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ClassesClient } from '@/components/academics/ClassesClient';

export const metadata = { title: 'Classes · Pfuma' };

export default async function ClassesPage() {
  const { user, can } = await getAccess();
  if (!can('academics.classes.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = <PageHeader title="Classes" description="Run each class this term: its teacher, size, subjects, timetable and register." breadcrumbs={[{ label: 'Academics' }, { label: 'Classes' }]} />;
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;

  const canManage = can('academics.classes.manage');
  const [data, staff] = await Promise.all([
    listClasses(user, term.id),
    canManage ? db.user.findMany({ where: { active: true, isSupport: false }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <ClassesClient term={data.term} classes={data.classes} staff={staff} canManage={canManage} />
    </div>
  );
}
