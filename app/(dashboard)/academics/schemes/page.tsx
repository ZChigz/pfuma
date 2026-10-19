import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { listSchemes } from '@/lib/academics/curriculum';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { SchemesListClient } from '@/components/academics/SchemesListClient';
import { linkButton } from '@/components/academics/shared';

export const metadata = { title: 'Schemes of work · Pfuma' };

export default async function SchemesPage({ searchParams }: { searchParams: { status?: string; departmentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.schemes.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const header = (
    <PageHeader
      title="Schemes of work" description="The plan for each subject and class, week by week, and the record of what was covered."
      breadcrumbs={[{ label: 'Academics' }, { label: 'Schemes of work' }]}
      actions={can('academics.syllabus.manage') || can('academics.schemes.view') ? <Link href="/academics/syllabus" className={linkButton}>Syllabus</Link> : undefined}
    />
  );
  if (!term) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
  const [data, departments] = await Promise.all([
    listSchemes(user, { termId: term.id, departmentId: searchParams.departmentId, status: searchParams.status }),
    db.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      <SchemesListClient term={data.term} dueDate={data.dueDate} rows={data.rows} wide={data.wide} departments={departments} canSetDue={can('academics.schemes.approve')} query={searchParams} />
    </div>
  );
}
