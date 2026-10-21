import { getAccess } from '@/lib/access';
import { listFunds } from '@/lib/finance/setup';
import { listSuppliers } from '@/lib/finance/spending';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { RequestForm } from '@/components/finance/RequestForm';

export const metadata = { title: 'New expense request · Pfuma' };

export default async function NewRequestPage() {
  const { user, can } = await getAccess();
  if (!can('finance.requests.create')) return <AccessDenied />;
  const [funds, currencies, suppliers] = await Promise.all([listFunds(user), getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId)), listSuppliers(user).catch(() => [])]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="New expense request" breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Expense requests', href: '/finance/requests' }, { label: 'New' }]} />
      <RequestForm funds={funds.filter((f) => f.active)} currencies={currencies} suppliers={suppliers.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
