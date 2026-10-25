import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getCount } from '@/lib/facilities/inventory';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryNav } from '@/components/facilities/InventoryNav';
import { CountSheet } from '@/components/facilities/CountSheet';

export const metadata = { title: 'Count sheet · Pfuma' };

export default async function CountPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('facilities.inventory.count') && !can('facilities.inventory.writeoff')) return <AccessDenied />;
  const count = await getCount(user, params.id).catch((e) => { if (e instanceof ServiceError && e.status === 404) return null; throw e; });
  if (!count) notFound();
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`Count: ${count.store}`} description="Type what is on the shelf. The system shows the difference as you go." breadcrumbs={[{ label: 'Stock counts', href: '/facilities/inventory/counts' }, { label: count.store }]} />
      <InventoryNav can={can} current="/facilities/inventory/counts" />
      <CountSheet id={count.id} lines={count.lines} open={count.status === 'OPEN' && can('facilities.inventory.count')} />
    </div>
  );
}
