import { getAccess } from '@/lib/access';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { ImportWizard } from '@/components/students/ImportWizard';

export const metadata = { title: 'Import students · Pfuma' };

export default async function ImportStudentsPage() {
  const { can } = await getAccess();
  if (!can('students.profiles.import')) return <AccessDenied />;
  return (
    <div className="flex max-w-3xl flex-col gap-4 pb-8">
      <PageHeader title="Import students" description="Upload a CSV, match its columns, review every row, then confirm." breadcrumbs={[{ label: 'Students', href: '/students' }, { label: 'Import' }]} />
      <ImportWizard />
    </div>
  );
}
