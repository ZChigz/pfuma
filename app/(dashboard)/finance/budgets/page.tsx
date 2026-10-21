import { getAccess } from '@/lib/access';
import { budgetReport, listCategories } from '@/lib/finance/spending';
import { listFunds } from '@/lib/finance/setup';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, Td, Th } from '@/components/finance/shared';
import { Money } from '@/components/finance/format';

export const metadata = { title: 'Budgets · Pfuma' };

export default async function BudgetsPage() {
  const { user, can } = await getAccess();
  if (!can('finance.budgets.manage') && !can('finance.reports.view') && !can('finance.expenses.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await db.$tx((tx) => getViewTerm(user.schoolId, tx));
  const [report, cats, funds, currencies] = await Promise.all([budgetReport(user, term?.id), listCategories(user), listFunds(user), db.$tx((tx) => enabledCurrencies(tx, user.schoolId))]);
  const manage = can('finance.budgets.manage');
  const catManage = can('finance.expenses.manage') || manage;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Budgets" description={`What each fund plans to spend per category in ${report.term.name}, and what has been spent. Spending with no budget line shows too, so nothing is hidden. A request over its budget is warned, not blocked.`}
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Budgets' }]}
        actions={manage ? (
          <FormAction label="Set a budget" variant="primary" size="md" url="/api/finance/budgets" extra={{ termId: report.term.id }} done="Budget saved" intro="Setting a budget for a fund, category and currency again replaces the earlier figure."
            fields={[
              { name: 'fundId', label: 'Fund', type: 'select', required: true, options: funds.filter((f) => f.active).map((f) => ({ value: f.id, label: f.name })) },
              { name: 'categoryId', label: 'Category', type: 'select', required: true, options: cats.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })) },
              { name: 'currency', label: 'Currency', type: 'select', required: true, initial: currencies[0] ?? 'USD', options: currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' })) },
              { name: 'amount', label: 'Amount for the term', type: 'money', required: true },
            ]} />
        ) : undefined} />
      <Section title={report.term.name}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr><Th>Fund</Th><Th>Category</Th><Th className="text-right">Budget</Th><Th className="text-right">Spent</Th><Th className="text-right">Left</Th></tr></thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={`${r.fundId}${r.categoryId}${r.currency}`} className="border-t border-line">
                  <Td>{r.fundName}</Td><Td>{r.category}</Td><Td className="text-right"><Money cents={r.budgetCents} currency={r.currency} /></Td><Td className="text-right"><Money cents={r.spentCents} currency={r.currency} /></Td>
                  <Td className={`text-right ${r.remainingCents < 0 ? 'text-danger' : ''}`}><Money cents={r.remainingCents} currency={r.currency} /></Td>
                </tr>
              ))}
              {report.rows.length === 0 && <tr><Td className="text-muted">No budget set and nothing spent this term.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Expense categories" action={catManage ? <FormAction label="Add a category" size="md" url="/api/finance/categories" done="Category added" fields={[{ name: 'name', label: 'Name', required: true, maxLength: 60 }]} /> : undefined}>
        <ul className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm ${c.active ? 'text-ink' : 'text-muted'}`}>
              {c.name}{!c.active && ' (off)'}
              {catManage && <RowAction label={c.active ? 'Off' : 'On'} variant="ghost" url={`/api/finance/categories/${c.id}`} method="PATCH" body={{ active: !c.active }} done="Saved" />}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
