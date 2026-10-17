import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AddStudentWizard } from '@/components/students/AddStudentWizard';

export const metadata = { title: 'Add student · Pfuma' };

export default async function NewStudentPage() {
  const { user, can } = await getAccess();
  if (!can('students.profiles.create')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const term = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
  const [classes, houses, sizes] = await Promise.all([
    db.schoolClass.findMany({ where: { active: true, level: { active: true } }, orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, capacity: true, level: { select: { order: true, name: true } } } }),
    db.house.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    term ? db.enrollment.groupBy({ by: ['classId'], where: { termId: term.id, status: 'ACTIVE' }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const size = new Map(sizes.map((s) => [s.classId, s._count._all]));
  return (
    <div className="flex max-w-3xl flex-col gap-4 pb-8">
      <PageHeader title="Add student" description="Four short steps. Only the essentials are required." breadcrumbs={[{ label: 'Students', href: '/students' }, { label: 'Add student' }]} />
      {!term && <p role="alert" className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">No term is open yet, so a student cannot be enrolled. Open a term under School Settings first.</p>}
      <AddStudentWizard
        classes={classes.map((c) => ({ id: c.id, name: c.name, levelOrder: c.level.order, levelName: c.level.name, size: size.get(c.id) ?? 0, capacity: c.capacity }))}
        houses={houses}
        canApproveTransfers={can('students.admissions.approve')}
      />
    </div>
  );
}
