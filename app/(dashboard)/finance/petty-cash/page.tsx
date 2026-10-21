import { getAccess } from '@/lib/access';
import { listFloats, listCategories } from '@/lib/finance/spending';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { Section, Td, Th } from '@/components/finance/shared';
import { Money } from '@/components/finance/format';

export const metadata = { title: 'Petty cash · Pfuma' };

export default async function PettyCashPage() {
  const { user, can } = await getAccess();
  if (!can('finance.expenses.manage') && !can('finance.expenses.record') && !can('finance.expenses.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const manage = can('finance.expenses.manage');
  const [floats, cats, staff] = await Promise.all([
    listFloats(user), listCategories(user),
    manage ? db.user.findMany({ where: { schoolId: user.schoolId, active: true, isSupport: false }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Petty cash" description="A small float held by one person for everyday spending. The bursar tops it up; the person holding it spends from it, within the limit, and keeps the receipts. Someone cannot top up their own float."
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Petty cash' }]}
        actions={manage ? (
          <FormAction label="Give someone a float" variant="primary" size="md" url="/api/finance/petty-cash/floats" done="Float created"
            fields={[
              { name: 'custodianId', label: 'Held by', type: 'select', required: true, options: staff.map((s) => ({ value: s.id, label: s.fullName })) },
              { name: 'currency', label: 'Currency', type: 'select', required: true, initial: 'USD', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] },
              { name: 'expenseLimit', label: 'Most that one expense can be', type: 'money', required: true },
            ]} />
        ) : undefined} />
      {floats.map((f) => (
        <Section key={f.id} title={`${f.custodian}: ${f.currency === 'USD' ? 'US dollars' : 'ZiG'}`} hint={`Holds ${(f.balanceCents / 100).toFixed(2)}. One expense is at most ${(f.expenseLimitCents / 100).toFixed(2)}.`}
          action={
            <div className="flex flex-wrap gap-2">
              {f.custodianId !== user.id && manage && <FormAction label="Top up" size="sm" variant="primary" url="/api/finance/petty-cash" extra={{ floatId: f.id, kind: 'TOPUP' }} done="Topped up" fields={[{ name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'description', label: 'Note', required: true, initial: 'Top-up', maxLength: 160 }]} />}
              {f.custodianId === user.id && (
                <FormAction label="Record spending" size="sm" variant="primary" url="/api/finance/petty-cash" extra={{ floatId: f.id, kind: 'EXPENSE' }} done="Recorded"
                  fields={[{ name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'description', label: 'What for', required: true, maxLength: 160 }, { name: 'categoryId', label: 'Category', type: 'select', options: cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })) }, { name: 'date', label: 'Date', type: 'date' }]} />
              )}
            </div>
          }>
          <table className="w-full text-sm">
            <tbody>
              {f.entries.map((e) => <tr key={e.id} className="border-t border-line"><Td>{e.date}</Td><Td>{e.kind === 'TOPUP' ? 'Top-up' : 'Spent'}</Td><Td>{e.description}</Td><Td className="text-right"><Money cents={e.kind === 'TOPUP' ? e.amountCents : -e.amountCents} currency={f.currency} /></Td></tr>)}
              {f.entries.length === 0 && <tr><Td className="text-muted">Nothing yet.</Td></tr>}
            </tbody>
          </table>
        </Section>
      ))}
      {floats.length === 0 && <p className="text-sm text-muted">No petty cash floats yet.</p>}
    </div>
  );
}
