import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { arrears, cashUp, expenditure, fundSummary } from '@/lib/finance/reports';
import { listFunds } from '@/lib/finance/setup';
import { REPORT_SLUGS, REPORT_TITLES } from '@/lib/finance/report-tables';
import { todayInHarare } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Notice, PrintButton, Section, Td, Th } from '@/components/finance/shared';
import { Money, fieldClass, methodLabel } from '@/components/finance/format';
import { CURRENCIES, type Cur } from '@/lib/finance/money';

export const metadata = { title: 'Finance reports · Pfuma' };

type Params = { r?: string; from?: string; to?: string; fundId?: string; classId?: string; currency?: string };
const TABS = [['cash-up', 'Cash-up'], ['funds', 'By fund'], ['arrears', 'Who owes'], ['spending', 'Spending']] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Params }) {
  const { user, can } = await getAccess();
  if (!can('finance.reports.view')) return <AccessDenied />;
  const which = TABS.find(([v]) => v === searchParams.r)?.[0] ?? 'cash-up';
  const today = todayInHarare();
  const from = searchParams.from || (which === 'cash-up' ? today : `${today.slice(0, 8)}01`);
  const to = searchParams.to || today;
  const currency = searchParams.currency === 'USD' || searchParams.currency === 'ZIG' ? (searchParams.currency as Cur) : undefined;
  const db = getScopedDb(user.schoolId, user.id);
  const [funds, classes] = await Promise.all([listFunds(user), db.schoolClass.findMany({ where: { schoolId: user.schoolId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } })]);
  const fund = funds.find((f) => f.id === searchParams.fundId);
  const csv = (name: string) => `/api/finance/reports/${name}?format=csv&from=${from}&to=${to}${searchParams.fundId ? `&fundId=${searchParams.fundId}` : ''}${searchParams.classId ? `&classId=${searchParams.classId}` : ''}${currency ? `&currency=${currency}` : ''}`;
  const exportLink = (name: string) => (can('finance.reports.export') ? <a className="text-sm font-semibold text-primary underline print:hidden" href={csv(name)}>Download as a spreadsheet</a> : undefined);
  const cur = (c: Cur) => (c === 'USD' ? 'US dollars' : 'ZiG');

  let body: React.ReactNode;
  if (which === 'cash-up') {
    const c = await cashUp(user, { from, to, fundId: searchParams.fundId });
    body = (
      <>
        {c.warnings.map((w) => <Notice key={w.code} tone={w.severity === 'warning' ? 'warn' : 'info'}>{w.message}</Notice>)}
        <Section title={`Takings ${c.from === c.to ? `on ${c.from}` : `${c.from} to ${c.to}`}${fund ? ` · ${fund.name}` : ''}`} hint="Verified payments only. Each currency is counted on its own." action={exportLink('cash-up')}>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">Money in, by how it was paid</h3>
              <table className="w-full text-sm"><thead><tr><Th>Method</Th><Th>Currency</Th><Th className="text-right">Receipts</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>{c.receipts.map((r) => <tr key={`${r.method}${r.currency}`} className="border-t border-line"><Td>{methodLabel(r.method)}</Td><Td>{cur(r.currency)}</Td><Td className="text-right">{r.count}</Td><Td className="text-right"><Money cents={r.cents} currency={r.currency} /></Td></tr>)}{c.receipts.length === 0 && <tr><Td className="text-muted">No verified receipts.</Td></tr>}</tbody></table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">Money in, by fund</h3>
              <table className="w-full text-sm"><thead><tr><Th>Fund</Th><Th>Currency</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>{c.receiptsByFund.map((r) => <tr key={`${r.fundId}${r.currency}`} className="border-t border-line"><Td>{r.fundName}</Td><Td>{cur(r.currency)}</Td><Td className="text-right"><Money cents={r.cents} currency={r.currency} /></Td></tr>)}{c.receiptsByFund.length === 0 && <tr><Td className="text-muted">Nothing.</Td></tr>}</tbody></table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">Money out</h3>
              <table className="w-full text-sm"><thead><tr><Th>What</Th><Th>Method</Th><Th>Currency</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody>
                  {c.expenses.map((r) => <tr key={`e${r.method}${r.currency}`} className="border-t border-line"><Td>Expenses ({r.count})</Td><Td>{methodLabel(r.method)}</Td><Td>{cur(r.currency)}</Td><Td className="text-right"><Money cents={r.cents} currency={r.currency} /></Td></tr>)}
                  {c.refundsPaid.map((r) => <tr key={`r${r.method}${r.currency}`} className="border-t border-line"><Td>Refunds ({r.count})</Td><Td>{methodLabel(r.method)}</Td><Td>{cur(r.currency)}</Td><Td className="text-right"><Money cents={r.cents} currency={r.currency} /></Td></tr>)}
                  {c.expenses.length + c.refundsPaid.length === 0 && <tr><Td className="text-muted">Nothing paid out.</Td></tr>}
                </tbody></table>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">Cash that should be in the till</h3>
              <table className="w-full text-sm"><tbody>{CURRENCIES.map((k) => <tr key={k} className="border-t border-line"><Td>{cur(k)}</Td><Td className="text-right text-base font-semibold"><Money cents={c.expectedCash[k]} currency={k} /></Td></tr>)}</tbody></table>
              <p className="mt-1 text-xs text-muted">Cash receipts, less cash expenses and cash refunds paid out. Mobile money, swipe and bank payments are not cash.</p>
              {c.pending.length > 0 && <p className="mt-2 text-xs text-warn">Not counted yet (waiting to be verified): {c.pending.map((p) => `${p.count} payment${p.count === 1 ? '' : 's'} of ${(p.cents / 100).toFixed(2)} ${p.currency}`).join(' · ')}</p>}
            </div>
          </div>
        </Section>
      </>
    );
  } else if (which === 'funds') {
    const f = await fundSummary(user, { from, to, fundId: searchParams.fundId });
    body = (
      <Section title={`By fund, ${f.from} to ${f.to}`} hint="Billed and credited in the period; collected, refunded and spent in the period; still owed and credit held as at today." action={exportLink('funds')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead><tr><Th>Fund</Th><Th>Currency</Th><Th className="text-right">Billed</Th><Th className="text-right">Credit notes</Th><Th className="text-right">Collected</Th><Th className="text-right">Refunded</Th><Th className="text-right">Spent</Th><Th className="text-right">Net</Th><Th className="text-right">Still owed</Th><Th className="text-right">Credit held</Th></tr></thead>
            <tbody>
              {f.rows.map((r) => <tr key={`${r.fundId}${r.currency}`} className="border-t border-line"><Td className="font-semibold">{r.fundName}</Td><Td>{cur(r.currency)}</Td>{([r.billed, r.adjusted, r.collected, r.refunded, r.spent, r.net, r.outstanding, r.credit] as number[]).map((v, i) => <Td key={i} className="text-right"><Money cents={v} currency={r.currency} className={i === 5 ? 'font-semibold' : ''} /></Td>)}</tr>)}
              {f.rows.length === 0 && <tr><Td className="text-muted">No activity in this period.</Td></tr>}
              {CURRENCIES.filter((k) => f.rows.some((r) => r.currency === k)).map((k) => {
                const t = f.totals[k];
                return <tr key={`t${k}`} className="border-t-2 border-line bg-canvas font-semibold"><Td>Total</Td><Td>{cur(k)}</Td>{[t.billed, t.adjusted, t.collected, t.refunded, t.spent, t.net, t.outstanding, t.credit].map((v, i) => <Td key={i} className="text-right"><Money cents={v} currency={k} /></Td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      </Section>
    );
  } else if (which === 'arrears') {
    // The report is "up to a term", so it needs one open; say so instead of failing.
    const a = await arrears(user, { classId: searchParams.classId, fundId: searchParams.fundId, currency }).catch((e) => {
      if (e instanceof ServiceError && e.status === 409) return null;
      throw e;
    });
    body = !a ? <EmptyState title="No term is open" description="Open a term in School Settings to see who owes." cta={{ label: 'School Settings', href: '/system/settings' }} /> : (
      <Section title={`Who owes, up to ${a.term.name}`} hint={`${a.students} student${a.students === 1 ? '' : 's'}${fund ? ` · ${fund.name} fund` : ''}. Each currency is shown on its own.`} action={exportLink('arrears')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr><Th>Student</Th><Th>Class</Th>{CURRENCIES.filter((k) => !currency || k === currency).map((k) => <Th key={k} className="text-right">Owes ({k === 'USD' ? 'US$' : 'ZiG'})</Th>)}</tr></thead>
            <tbody>
              {a.rows.map((r) => <tr key={r.studentId} className="border-t border-line"><Td><Link className="text-primary underline" href={`/finance/accounts/${r.studentId}`}>{r.name}</Link><div className="text-xs text-muted">{r.admissionNumber}</div></Td><Td>{r.className ?? '—'}</Td>{CURRENCIES.filter((k) => !currency || k === currency).map((k) => <Td key={k} className="text-right"><Money cents={r.balances[k].outstanding} currency={k} /></Td>)}</tr>)}
              {a.rows.length === 0 && <tr><Td className="text-muted">Nobody owes anything.</Td></tr>}
              <tr className="border-t-2 border-line bg-canvas font-semibold"><Td>Total</Td><Td />{CURRENCIES.filter((k) => !currency || k === currency).map((k) => <Td key={k} className="text-right"><Money cents={a.totals[k].outstanding} currency={k} /></Td>)}</tr>
            </tbody>
          </table>
        </div>
      </Section>
    );
  } else {
    const e = await expenditure(user, { from, to, fundId: searchParams.fundId });
    body = (
      <Section title={`Spending, ${e.from} to ${e.to}`} hint="Paid expenses that were not voided, by fund and category." action={exportLink('expenditure')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr><Th>Fund</Th><Th>Category</Th><Th>Currency</Th><Th className="text-right">Count</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {e.rows.map((r) => <tr key={`${r.fundId}${r.category}${r.currency}`} className="border-t border-line"><Td>{r.fundName}</Td><Td>{r.category}</Td><Td>{cur(r.currency)}</Td><Td className="text-right">{r.count}</Td><Td className="text-right"><Money cents={r.cents} currency={r.currency} /></Td></tr>)}
              {e.rows.length === 0 && <tr><Td className="text-muted">No spending in this period.</Td></tr>}
              {CURRENCIES.filter((k) => e.totals[k] !== 0).map((k) => <tr key={`t${k}`} className="border-t-2 border-line bg-canvas font-semibold"><Td>Total</Td><Td /><Td>{cur(k)}</Td><Td /><Td className="text-right"><Money cents={e.totals[k]} currency={k} /></Td></tr>)}
            </tbody>
          </table>
        </div>
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Finance reports" description="Every report can be limited to one fund, and every total is kept per currency." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Reports' }]} actions={<PrintButton />} />
      <Section title="All reports" hint="Each can be downloaded as Excel, PDF or CSV, and limited to one fund.">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_SLUGS.map((slug) => <li key={slug}><Link className="block rounded-xl border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-tint" href={`/finance/reports/table/${slug}`}>{REPORT_TITLES[slug]}</Link></li>)}
        </ul>
      </Section>
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-white p-1 print:hidden" aria-label="Report">
        {TABS.map(([v, label]) => <Link key={v} href={`/finance/reports?r=${v}`} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${which === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
      </nav>
      <form method="get" className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2 lg:grid-cols-6 print:hidden">
        <input type="hidden" name="r" value={which} />
        {which !== 'arrears' && <><input type="date" name="from" defaultValue={from} aria-label="From" className={fieldClass} /><input type="date" name="to" defaultValue={to} max={today} aria-label="To" className={fieldClass} /></>}
        <select name="fundId" defaultValue={searchParams.fundId ?? ''} aria-label="Fund" className={fieldClass}><option value="">All funds</option>{funds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        {which === 'arrears' && <><select name="classId" defaultValue={searchParams.classId ?? ''} aria-label="Class" className={fieldClass}><option value="">All classes</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select name="currency" defaultValue={currency ?? ''} aria-label="Currency" className={fieldClass}><option value="">Both currencies</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select></>}
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
      </form>
      {body}
      {funds.length === 0 && <EmptyState title="No funds yet" />}
    </div>
  );
}
