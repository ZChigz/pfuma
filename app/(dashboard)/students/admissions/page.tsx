import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listIntakes } from '@/lib/students/admissions';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { IntakesClient } from '@/components/students/AdmissionsClient';

export const metadata = { title: 'Admissions · Pfuma' };

export default async function AdmissionsPage() {
  const { user, can } = await getAccess();
  if (!can('students.admissions.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const [intakes, levels] = await Promise.all([listIntakes(user), db.level.findMany({ where: { active: true }, orderBy: { order: 'asc' }, select: { id: true, name: true } })]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Admissions" description="From the first enquiry to the first day. Open an intake to see its applicants." breadcrumbs={[{ label: 'Student Information' }, { label: 'Admissions' }]} />
      <IntakesClient intakes={intakes} levels={levels} canManage={can('students.admissions.manage')} />
    </div>
  );
}
