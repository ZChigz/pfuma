import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listExpenses } from '@/lib/finance/expenses';
import { listFunds } from '@/lib/finance/setup';
import { listCategories, listSuppliers } from '@/lib/finance/spending';
import { enabledCurrencies, todayInHarare } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { METHOD_OPTIONS, Money, Pager, fieldClass, methodLabel } from '@/components/finance/format';

export const metadata = { title: 'Expenses · Pfuma' };

type Params = { fundId?: string; currency?: string; from?: string; to?: string; voided?: string; page?: string };

export default async function ExpensesPage({ searchParams }: { searchParams: Params }) {
  const { user, can } = await getAccess();
  if (!can('finance.expenses.view') && !can('finance.expenses.record') && !can('finance.reports.view')) return <AccessDenied />;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const currency = searchParams.currency === 'USD' || searchParams.currency === 'ZIG' ? searchParams.currency : undefined;
  const [list, funds, currencies, cats, sups] = await Promise.all([
    listExpenses(user, { fundId: searchParams.fundId, currency, from: searchParams.from, to: searchParams.to, includeVoided: searchParams.voided === '1', page, pageSize: 50 }),
    listFunds(user),
    getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId)),
    listCategories(user).catch(() => []),
    listSuppliers(user).catch(() => []),
  ]);
  const qs = (p: number) => `/finance/expenses?${new URLSearchParams({ ...Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => v && k !== 'page')), page: String(p) })}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Expenses" description="Money that has left the school: a paid expense request, or a direct expense the bursar recorded. A mistake is voided by someone else; the row stays." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Expenses' }]}
        actions={can('finance.expenses.record') ? (
          <FormAction label="Record a direct expense" variant="primary" size="md" url="/api/finance/expenses" done="Expense recorded" intro="For small purchases made without a request. For larger amounts raise an expense request, so a second person approves it."
            fields={[{ name: 'fundId', label: 'Fund', type: 'select', required: true, options: funds.filter((f) => f.active).map((f) => ({ value: f.id, label: f.name })) }, { name: 'categoryId', label: 'Category', type: 'select', required: true, options: cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })) },
              { name: 'supplierId', label: 'Supplier', type: 'select', options: sups.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })) },
              { name: 'description', label: 'What was bought', required: true, maxLength: 200 }, { name: 'payee', label: 'Paid to', maxLength: 80 },
              { name: 'currency', label: 'Currency', type: 'select', required: true, initial: currencies[0] ?? 'USD', options: currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' })) },
              { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'method', label: 'Paid by', type: 'select', required: true, initial: 'CASH', options: METHOD_OPTIONS }, { name: 'paidOn', label: 'Date paid', type: 'date', hint: 'Empty means today' }, { name: 'reference', label: 'Reference', maxLength: 80 }, { name: 'receiptKey', label: 'Receipt or invoice (a photo or PDF)', type: 'file', hint: 'Needed above the amount the school has set' }]} />
        ) : undefined} />
      <form method="get" className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <select name="fundId" defaultValue={searchParams.fundId ?? ''} aria-label="Fund" className={fieldClass}><option value="">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select name="currency" defaultValue={currency ?? ''} aria-label="Currency" className={fieldClass}><option value="">Both currencies</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select>
        <input type="date" name="from" defaultValue={searchParams.from} aria-label="From" className={fieldClass} />
        <input type="date" name="to" defaultValue={searchParams.to ?? ''} max={todayInHarare()} aria-label="To" className={fieldClass} />
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="voided" value="1" defaultChecked={searchParams.voided === '1'} className="h-4 w-4" /> Show voided</label>
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Filter</button>
      </form>
      <Section title={`${list.total} expense${list.total === 1 ? '' : 's'}`}
        action={can('finance.reports.export') ? <a className="text-sm font-semibold text-primary underline" href={`/api/finance/reports/expenditure?format=csv${searchParams.from ? `&from=${searchParams.from}` : ''}${searchParams.to ? `&to=${searchParams.to}` : ''}${searchParams.fundId ? `&fundId=${searchParams.fundId}` : ''}`}>Download as a spreadsheet</a> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem]">
            <thead><tr><Th>Date</Th><Th>Expense</Th><Th>Fund</Th><Th>Method</Th><Th className="text-right">Amount</Th><Th>Recorded by</Th><Th /></tr></thead>
            <tbody>
              {list.rows.map((e) => (
                <tr key={e.id} className={`border-t border-line align-top ${e.voided ? 'text-muted line-through' : ''}`}>
                  <Td>{e.paidOn}</Td>
                  <Td>{e.description}<div className="text-xs text-muted no-underline">{e.category}{e.payee ? ` · ${e.payee}` : ''}{e.requestNumber ? <> · <Link className="underline" href="/finance/requests">{e.requestNumber}</Link></> : e.source === 'DIRECT' ? ' · direct' : ''}</div></Td>
                  <Td>{e.fundName}</Td><Td>{methodLabel(e.method)}</Td><Td className="text-right"><Money cents={e.amountCents} currency={e.currency} /></Td>
                  <Td>{e.recordedBy}</Td>
                  <Td>
                    {e.voided ? <Badge variant="neutral" label="Voided" /> : can('finance.expenses.void') && e.recordedById !== user.id ? <RowAction label="Void" variant="danger" title="Void this expense" url={`/api/finance/expenses/${e.id}/void`} reason={{ label: 'Why is it a mistake?', min: 10 }} done="Expense voided" /> : null}
                    {e.voided && e.voidReason && <div className="max-w-[12rem] text-xs text-muted no-underline">{e.voidReason}</div>}
                  </Td>
                </tr>
              ))}
              {list.rows.length === 0 && <tr><Td className="text-muted">No expenses match.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={qs} />
      </Section>
    </div>
  );
}
