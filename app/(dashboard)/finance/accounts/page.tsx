import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listAccounts } from '@/lib/finance/accounts';
import { listFunds } from '@/lib/finance/setup';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Money, Pager, Section, Td, Th, fieldClass } from '@/components/finance/shared';
import { RecordPaymentModal } from '@/components/finance/RecordPaymentModal';
import { CURRENCIES, type Cur } from '@/lib/finance/money';

export const metadata = { title: 'Student accounts · Pfuma' };

type Params = { q?: string; classId?: string; owing?: string; fundId?: string; currency?: string; page?: string };

export default async function AccountsPage({ searchParams }: { searchParams: Params }) {
  const { user, can } = await getAccess();
  if (!can('finance.accounts.view') && !can('finance.payments.record') && !can('finance.charges.create') && !can('finance.reports.view')) return <AccessDenied />;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const currency = searchParams.currency === 'USD' || searchParams.currency === 'ZIG' ? (searchParams.currency as Cur) : undefined;
  const [list, funds, classes] = await Promise.all([
    listAccounts(user, { q: searchParams.q, classId: searchParams.classId, owing: searchParams.owing === '1', fundId: searchParams.fundId, currency, page, pageSize: 50 }),
    listFunds(user),
    getScopedDb(user.schoolId, user.id).schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: [{ name: 'asc' }], select: { id: true, name: true } }),
  ]);
  const href = (p: number) => `/finance/accounts?${new URLSearchParams({ ...(searchParams.q ? { q: searchParams.q } : {}), ...(searchParams.classId ? { classId: searchParams.classId } : {}), ...(searchParams.owing ? { owing: '1' } : {}), ...(searchParams.fundId ? { fundId: searchParams.fundId } : {}), ...(currency ? { currency } : {}), page: String(p) })}`;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Student accounts" description="What each student owes, per currency. Use the fund filter to see one fund only." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Student accounts' }]}
        actions={can('finance.payments.record') ? <RecordPaymentModal funds={funds.filter((f) => f.active)} /> : undefined} />
      <form method="get" className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input name="q" defaultValue={searchParams.q} placeholder="Name or admission number" aria-label="Search" className={`${fieldClass} lg:col-span-2`} />
        <select name="classId" defaultValue={searchParams.classId ?? ''} aria-label="Class" className={fieldClass}><option value="">All classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="fundId" defaultValue={searchParams.fundId ?? ''} aria-label="Fund" className={fieldClass}><option value="">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select name="currency" defaultValue={currency ?? ''} aria-label="Currency" className={fieldClass}><option value="">Both currencies</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" name="owing" value="1" defaultChecked={searchParams.owing === '1'} className="h-4 w-4" /> Only those who owe</label>
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white lg:col-span-6 sm:col-span-2">Filter</button>
      </form>
      <Section title={`${list.total} student${list.total === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead><tr><Th>Student</Th><Th>Class</Th>{CURRENCIES.filter((c) => !currency || c === currency).map((c) => <Th key={c} className="text-right">{c === 'USD' ? 'Owes (US$)' : 'Owes (ZiG)'}</Th>)}{CURRENCIES.filter((c) => !currency || c === currency).map((c) => <Th key={`k${c}`} className="text-right">{c === 'USD' ? 'Credit (US$)' : 'Credit (ZiG)'}</Th>)}</tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.studentId} className="border-t border-line">
                  <Td><Link className="font-semibold text-primary underline" href={`/finance/accounts/${r.studentId}`}>{r.name}</Link><div className="text-xs text-muted">{r.admissionNumber}{r.boarding === 'BOARDER' ? ' · boarder' : ''}{r.status !== 'ACTIVE' ? ` · ${r.status.toLowerCase()}` : ''}</div></Td>
                  <Td>{r.className ?? '—'}</Td>
                  {CURRENCIES.filter((c) => !currency || c === currency).map((c) => <Td key={c} className="text-right"><Money cents={r.balances[c].outstanding} currency={c} className={r.balances[c].outstanding > 0 ? 'font-semibold text-danger' : 'text-muted'} /></Td>)}
                  {CURRENCIES.filter((c) => !currency || c === currency).map((c) => <Td key={`k${c}`} className="text-right"><Money cents={r.balances[c].credit} currency={c} className="text-muted" /></Td>)}
                </tr>
              ))}
              {list.rows.length === 0 && <tr><Td className="text-muted">No student matches.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={href} />
      </Section>
    </div>
  );
}
