import { getAccess } from '@/lib/access';
import { listStores, requestsToReceive, stockTable } from '@/lib/facilities/inventory';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryNav } from '@/components/facilities/InventoryNav';
import { ReceiveForm } from '@/components/facilities/ReceiveForm';

export const metadata = { title: 'Receive goods · Pfuma' };

export default async function ReceivePage() {
  const { user, can } = await getAccess();
  if (!can('facilities.inventory.receive')) return <AccessDenied />;
  const [{ stores }, requests, { rows }] = await Promise.all([listStores(user), requestsToReceive(user), stockTable(user)]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Receive goods" description="Goods bought through a purchase request are received from that request, so the cost and the item stay linked. A donation or opening stock needs a reason." />
      <InventoryNav can={can} current="/facilities/inventory/receive" />
      <ReceiveForm stores={stores.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} requests={requests}
        items={rows.filter((r) => r.active).map((r) => ({ id: r.itemId, name: r.name, size: r.size, unit: r.unit, tracksExpiry: r.tracksExpiry }))} />
    </div>
  );
}
