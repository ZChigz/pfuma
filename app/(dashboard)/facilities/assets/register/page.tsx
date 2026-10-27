import { getAccess } from '@/lib/access';
import { listCategories, requestsToRegister, staffOptions } from '@/lib/facilities/assets';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AssetNav } from '@/components/facilities/AssetNav';
import { RegisterFromRequest } from '@/components/facilities/RegisterFromRequest';

export const metadata = { title: 'Register from a purchase request · Pfuma' };

export default async function RegisterPage() {
  const { user, can } = await getAccess();
  if (!can('facilities.assets.manage')) return <AccessDenied />;
  const [requests, categories, people] = await Promise.all([requestsToRegister(user), listCategories(user), staffOptions(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Register from a purchase request" description="What a paid request bought goes straight into the register with its cost, supplier and date." breadcrumbs={[{ label: 'Assets', href: '/facilities/assets' }, { label: 'From a purchase request' }]} />
      <AssetNav can={can} current="/facilities/assets" />
      <RegisterFromRequest requests={requests} categories={categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))} people={people} />
    </div>
  );
}
