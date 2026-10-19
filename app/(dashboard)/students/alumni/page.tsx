import { getAccess } from '@/lib/access';
import { ALUMNI_PAGE_SIZE, listAlumni } from '@/lib/students/alumni';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlumniClient } from '@/components/students/LeaversAlumniClients';

export const metadata = { title: 'Alumni · Pfuma' };

export default async function AlumniPage({ searchParams }: { searchParams: { q?: string; year?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.alumni.view')) return <AccessDenied />;
  const data = await listAlumni(user, { q: searchParams.q, year: Number(searchParams.year) || undefined, page: Number(searchParams.page) || 1 });
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Alumni" description="Former students who completed O Level or A Level, with their contact details and what they went on to." breadcrumbs={[{ label: 'Student Information' }, { label: 'Alumni' }]} />
      <AlumniClient rows={data.rows} total={data.total} page={Number(searchParams.page) || 1} pageSize={ALUMNI_PAGE_SIZE} years={data.years} canEdit={can('students.leavers.manage')} canExport={can('students.alumni.export')} />
    </div>
  );
}
