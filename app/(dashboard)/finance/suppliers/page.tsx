import { getAccess } from '@/lib/access';
import { listSuppliers, supplierSpend } from '@/lib/finance/spending';
import { todayInHarare } from '@/lib/finance/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { Money } from '@/components/finance/format';

export const metadata = { title: 'Suppliers · Pfuma' };

export default async function SuppliersPage() {
  const { user, can } = await getAccess();
  if (!can('finance.suppliers.manage') && !can('finance.reports.view')) return <AccessDenied />;
  const manage = can('finance.suppliers.manage');
  const year = todayInHarare().slice(0, 4);
  const [suppliers, spend] = await Promise.all([listSuppliers(user), supplierSpend(user, { from: `${year}-01-01`, to: todayInHarare() })]);
  const fields = [
    { name: 'name', label: 'Name', required: true, maxLength: 80 }, { name: 'contact', label: 'Contact person', maxLength: 80 }, { name: 'phone', label: 'Phone', maxLength: 30 },
    { name: 'ecocash', label: 'EcoCash number', maxLength: 30 }, { name: 'bankDetails', label: 'Bank details', maxLength: 200 }, { name: 'taxNumber', label: 'Tax number', maxLength: 40 },
  ];
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Suppliers" description="Who the school buys from. A supplier chosen on an expense request or an expense shows in the spend per supplier." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Suppliers' }]}
        actions={manage ? <FormAction label="Add a supplier" variant="primary" size="md" url="/api/finance/suppliers" done="Supplier added" fields={fields} /> : undefined} />
      <Section title={`${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr><Th>Name</Th><Th>Contact</Th><Th>Pay to</Th><Th className="text-right">Spent this year</Th><Th /></tr></thead>
            <tbody>
              {suppliers.map((s) => {
                const mine = spend.filter((x) => x.supplierId === s.id);
                return (
                  <tr key={s.id} className={`border-t border-line align-top ${s.active ? '' : 'text-muted'}`}>
                    <Td>{s.name}{!s.active && ' (off)'}{s.taxNumber && <div className="text-xs text-muted">Tax no. {s.taxNumber}</div>}</Td>
                    <Td>{[s.contact, s.phone].filter(Boolean).join(' · ') || '—'}</Td><Td>{[s.ecocash && `EcoCash ${s.ecocash}`, s.bankDetails].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td className="text-right">{mine.length ? mine.map((m) => <div key={m.currency}><Money cents={m.cents} currency={m.currency} /> <span className="text-xs text-muted">({m.count})</span></div>) : '—'}</Td>
                    <Td>{manage && <div className="flex gap-2"><FormAction label="Edit" size="sm" variant="ghost" url={`/api/finance/suppliers/${s.id}`} method="PATCH" done="Saved" fields={fields.map((f) => ({ ...f, required: false, initial: String((s as Record<string, unknown>)[f.name === 'contact' ? 'contact' : f.name] ?? '') }))} /><RowAction label={s.active ? 'Switch off' : 'Switch on'} variant="ghost" url={`/api/finance/suppliers/${s.id}`} method="PATCH" body={{ active: !s.active }} done="Saved" /></div>}</Td>
                  </tr>
                );
              })}
              {suppliers.length === 0 && <tr><Td className="text-muted">No suppliers yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
