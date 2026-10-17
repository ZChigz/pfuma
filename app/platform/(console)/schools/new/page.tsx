import { listPlans } from '@/lib/platform/schools';
import { PageHeader } from '@/components/ui/PageHeader';
import { NewSchoolForm } from '@/components/platform/NewSchoolForm';

export const metadata = { title: 'New school · Pfuma Platform' };

export default async function NewSchoolPage() {
  const plans = await listPlans();
  return (
    <>
      <PageHeader title="New school" description="Creates the school with its first Owner and Administrator. Each gets an invite link to choose their own password." breadcrumbs={[{ label: 'Schools', href: '/platform' }, { label: 'New school' }]} />
      <NewSchoolForm plans={plans} />
    </>
  );
}
