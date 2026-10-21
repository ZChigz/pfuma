import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { financeDashboard } from '@/lib/finance/dashboard';
import { listFunds } from '@/lib/finance/setup';
import { ANY_FINANCE, enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { RecordPaymentModal } from '@/components/finance/RecordPaymentModal';
import { Notice, Section, fieldClass, linkButton, methodLabel } from '@/components/finance/shared';
import { CURRENCIES, formatMoney, type Cur, type Totals } from '@/lib/finance/money';

export const metadata = { title: 'Finance · Pfuma' };

const label = (c: Cur) => (c === 'USD' ? 'USD' : 'ZiG');

/** One figure per currency, both always shown. */
function Both({ totals, tone }: { totals: Totals; tone?: 'danger' }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {CURRENCIES.map((c) => (
        <p key={c} className={`flex items-baseline justify-between gap-3 tabular-nums ${tone === 'danger' && totals[c] > 0 ? 'text-danger' : 'text-ink'}`}>
          <span className="text-xs font-semibold text-muted">{label(c)}</span><span className="text-xl font-bold">{formatMoney(totals[c], c)}</span>
        </p>
      ))}
    </div>
  );
}

function Card({ title, href, children, note }: { title: string; href?: string; children: React.ReactNode; note?: React.ReactNode }) {
  const body = (
    <div className="h-full rounded-2xl bg-white p-4 hover:ring-2 hover:ring-primary/30">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {children}
      {note && <div className="mt-2 text-xs text-muted">{note}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

function Bar({ value, max, className = 'bg-primary' }: { value: number; max: number; className?: string }) {
  return <div className="h-2.5 w-full rounded-full bg-canvas"><div className={`h-2.5 rounded-full ${className}`} style={{ width: `${max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0}%` }} /></div>;
}

export default async function FinanceHome({ searchParams }: { searchParams: { termId?: string; fundId?: string } }) {
  const { user, can } = await getAccess();
  if (!ANY_FINANCE.some((k) => can(k))) return <AccessDenied />;
  const header = <PageHeader title="Finance" description="How much came in, who still owes, and what needs action today. US dollars and ZiG are always shown apart." breadcrumbs={[{ label: 'Finance' }]} />;
  // People who may only raise expense requests have no dashboard; they get their requests.
  const dash = ['finance.reports.view', 'finance.payments.verify', 'finance.accounts.view', 'finance.requests.approve', 'finance.requests.disburse'] as const;
  if (!dash.some((k) => can(k))) {
    return <div className="flex flex-col gap-4">{header}<EmptyState title="Ask for money to be spent" description="Raise an expense request, and follow it from approval to payment." cta={{ label: 'Expense requests', href: '/finance/requests' }} /></div>;
  }
  let d;
  try {
    d = await financeDashboard(user, { termId: searchParams.termId, fundId: searchParams.fundId });
  } catch (e) {
    if ((e as { status?: number }).status === 409) return <div className="flex flex-col gap-4">{header}<EmptyState title="No term yet" description="Set up an academic year and its terms in School Settings first." cta={{ label: 'School Settings', href: '/system/settings' }} /></div>;
    throw e;
  }
  const [funds, currencies] = await Promise.all([listFunds(user), getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId))]);
  const fundQ = d.fund ? `fundId=${d.fund.id}` : '';
  const tail = (s: string) => `${s}${s.includes('?') ? '&' : '?'}${fundQ}`;
  const maxWeek = Math.max(1, ...d.weekly.flatMap((w) => CURRENCIES.flatMap((c) => [w.thisTerm[c], w.lastTerm[c]])));
  const maxMethod = Math.max(1, ...d.byMethod.map((m) => m.count));
  const rateText = (c: Cur) => {
    const r = d.collectionRate[c];
    if (r.rate === null) return 'Nothing billed';
    return `${r.rate}%${r.lastTermRate !== null && d.lastTerm ? ` · ${d.lastTerm.name} at this point: ${r.lastTermRate}%` : ''}`;
  };
  const exportHref = `/api/finance/reports/arrears?format=csv&termId=${d.term.id}${fundQ ? `&${fundQ}` : ''}`;

  return (
    <div className="flex flex-col gap-4 pb-8">
      {header}
      {d.staleRate && <Notice tone="warn">The exchange rate is out of date. <Link className="underline" href="/finance/rates">Set today’s rate</Link> so ZiG payments can be taken.</Notice>}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4" aria-label="Term and fund">
        <div className="flex flex-col gap-1.5"><label htmlFor="fd-term" className="text-sm font-medium text-ink">Term</label>
          <select id="fd-term" name="termId" defaultValue={d.term.id} className={fieldClass}>{d.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="flex flex-col gap-1.5"><label htmlFor="fd-fund" className="text-sm font-medium text-ink">Fund</label>
          <select id="fd-fund" name="fundId" defaultValue={d.fund?.id ?? ''} className={fieldClass}><option value="">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white">Show</button>
        <div className="ml-auto flex flex-wrap gap-2">
          {can('finance.payments.record') && <RecordPaymentModal funds={funds.filter((f) => f.active)} enabledCurrencies={currencies} label="Record payment" />}
          {can('finance.charges.create') && <Link href="/finance/fees" className={linkButton}>Bulk billing</Link>}
          {(can('finance.expenses.record') || can('finance.requests.create')) && <Link href={can('finance.expenses.record') ? '/finance/expenses' : '/finance/requests/new'} className={linkButton}>New expense</Link>}
          {can('finance.reports.export') && <a href={exportHref} className={linkButton}>Export</a>}
        </div>
      </form>
      <p className="text-sm text-muted">{d.term.name}{d.fund ? ` · ${d.fund.name} fund` : ''}{d.term.status === 'CLOSED' ? ' · closed' : ''}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Billed this term" href={tail(`/finance/reports?r=funds&from=${d.term.startDate}&to=${d.term.endDate}`)} note="Charged, after discounts and credit notes."><Both totals={d.billed} /></Card>
        <Card title="Collected this term" href={tail(`/finance/payments?status=VERIFIED&from=${d.term.startDate}&to=${d.term.endDate}`)} note="Verified payments settling this term&apos;s charges."><Both totals={d.collected} /></Card>
        <Card title="Collection rate" href={tail(`/finance/reports?r=funds&from=${d.term.startDate}&to=${d.term.endDate}`)} note="Collected ÷ billed, against the same point last term.">
          <div className="mt-1 flex flex-col gap-1">{CURRENCIES.map((c) => <p key={c} className="text-sm text-ink"><span className="mr-2 text-xs font-semibold text-muted">{label(c)}</span><span className="text-xl font-bold tabular-nums">{d.collectionRate[c].rate === null ? '—' : `${d.collectionRate[c].rate}%`}</span><span className="block text-xs text-muted">{rateText(c)}</span></p>)}</div>
        </Card>
        <Card title="Outstanding" href={tail('/finance/accounts?owing=1')} note={<>This term&apos;s unpaid balance. Arrears from earlier terms:{CURRENCIES.map((c) => <span key={c} className="ml-2 tabular-nums font-semibold text-ink">{formatMoney(d.outstanding.earlier[c], c)}</span>)}</>}>
          <Both totals={d.outstanding.thisTerm} tone="danger" />
        </Card>
        <Card title="Collected today" href={tail('/finance/payments?status=PENDING')} note={<>Waiting to be verified today: {d.today.pendingCount} payment{d.today.pendingCount === 1 ? '' : 's'}{CURRENCIES.filter((c) => d.today.pending[c]).map((c) => <span key={c} className="ml-2 tabular-nums">{formatMoney(d.today.pending[c], c)}</span>)}</>}>
          <Both totals={d.today.collected} />
        </Card>
        <Card title="Learners owing" href={tail('/finance/accounts?owing=1')} note={`${d.owing.moreThanOneTerm} owe for more than one term.`}>
          <p className="mt-1 text-3xl font-bold tabular-nums text-ink">{d.owing.learners}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Collections by week" hint={`${d.term.name}${d.lastTerm ? ` against ${d.lastTerm.name}` : ''}. Dark bar: this term. Light bar: last term.`}>
          {CURRENCIES.map((c) => (
            <div key={c} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold text-muted">{label(c)}</h3>
              <div className="flex items-end gap-1" role="img" aria-label={`Weekly collections in ${label(c)}`}>
                {d.weekly.map((w) => (
                  <div key={w.week} className="flex flex-1 flex-col items-center gap-1" title={`Week ${w.week}: ${formatMoney(w.thisTerm[c], c)} (last term ${formatMoney(w.lastTerm[c], c)})`}>
                    <div className="flex h-24 w-full items-end justify-center gap-0.5">
                      <div className="w-1/2 rounded-t bg-primary" style={{ height: `${Math.round((w.thisTerm[c] / maxWeek) * 100)}%`, minHeight: w.thisTerm[c] ? 2 : 0 }} />
                      <div className="w-1/2 rounded-t bg-primary/30" style={{ height: `${Math.round((w.lastTerm[c] / maxWeek) * 100)}%`, minHeight: w.lastTerm[c] ? 2 : 0 }} />
                    </div>
                    <span className="text-[10px] text-muted">{w.week}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">Weeks of the term. Each currency has its own scale only through the shared tallest bar; read the amounts in the hover text.</p>
        </Section>

        <Section title="Outstanding by form" hint="Everything unpaid up to this term, by the learner's form.">
          {d.byForm.length === 0 ? <p className="text-sm text-muted">Nobody owes anything.</p> : CURRENCIES.map((c) => {
            const max = Math.max(1, ...d.byForm.map((f) => f.outstanding[c]));
            return (
              <div key={c} className="mb-3">
                <h3 className="mb-1 text-xs font-semibold text-muted">{label(c)}</h3>
                <ul className="flex flex-col gap-1.5">{d.byForm.map((f) => (
                  <li key={f.form} className="grid grid-cols-[5rem_1fr_6rem] items-center gap-2 text-sm"><span className="text-ink">{f.form}</span><Bar value={f.outstanding[c]} max={max} className="bg-danger/70" /><span className="text-right tabular-nums text-ink">{formatMoney(f.outstanding[c], c)}</span></li>
                ))}</ul>
              </div>
            );
          })}
        </Section>

        <Section title="Money in, by kind" hint="Cash, EcoCash, bank, Paynow and others, verified this term.">
          {d.byBucket.length === 0 ? <p className="text-sm text-muted">No verified payments yet.</p> : (
            <ul className="flex flex-col gap-1 text-sm">{d.byBucket.map((b) => <li key={b.bucket} className="flex justify-between gap-2"><span className="text-ink">{b.bucket}</span><span className="tabular-nums text-muted">{b.count} · {CURRENCIES.filter((c) => b.totals[c]).map((c) => formatMoney(b.totals[c], c)).join(' · ')}</span></li>)}</ul>
          )}
        </Section>

        <Section title="Payments by method" hint="Verified payments this term. Each amount is in its own currency.">
          {d.byMethod.length === 0 ? <p className="text-sm text-muted">No verified payments yet.</p> : (
            <ul className="flex flex-col gap-2">{d.byMethod.map((m) => (
              <li key={m.method} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm">
                <span className="text-ink">{methodLabel(m.method)}</span>
                <div><Bar value={m.count} max={maxMethod} /><p className="mt-0.5 text-xs text-muted tabular-nums">{m.count} payment{m.count === 1 ? '' : 's'}{CURRENCIES.filter((c) => m.totals[c]).map((c) => ` · ${formatMoney(m.totals[c], c)}`)}</p></div>
              </li>
            ))}</ul>
          )}
        </Section>

        <Section title="Needs action">
          <ul className="flex flex-col gap-4 text-sm">
            {(can('finance.payments.verify') || can('finance.payments.view')) && (
              <li>
                <Link href={tail('/finance/payments?status=PENDING')} className="font-semibold text-primary underline">{d.waiting.payments.count} payment{d.waiting.payments.count === 1 ? '' : 's'} waiting for verification</Link>
                {d.waiting.payments.count > 0 && <span className="ml-2 tabular-nums text-muted">{CURRENCIES.filter((c) => d.waiting.payments.totals[c]).map((c) => formatMoney(d.waiting.payments.totals[c], c)).join(' · ')}</span>}
                {d.waiting.payments.oldest.length > 0 && (
                  <ol className="mt-1 list-decimal pl-5 text-xs text-muted">{d.waiting.payments.oldest.map((p) => <li key={p.id}><Link className="underline" href={`/finance/payments/${p.id}/receipt`}>{p.receiptNumber ?? 'Acknowledgement'}</Link> · {p.student} · {p.receivedOn} · {formatMoney(p.amountCents, p.currency)}</li>)}</ol>
                )}
              </li>
            )}
            {(can('finance.requests.approve') || can('finance.requests.view')) && <li><Link href={tail('/finance/requests?status=PENDING')} className="font-semibold text-primary underline">{d.waiting.requestsToApprove} purchase request{d.waiting.requestsToApprove === 1 ? '' : 's'} waiting for approval</Link></li>}
            {(can('finance.requests.disburse') || can('finance.requests.view')) && <li><Link href={tail('/finance/requests?status=APPROVED')} className="font-semibold text-primary underline">{d.waiting.requestsToPay} approved request{d.waiting.requestsToPay === 1 ? '' : 's'} waiting to be paid</Link></li>}
            {d.cashUps.length > 0 && (
              <li>
                <Link href="/finance/cash-up" className="font-semibold text-primary underline">Today’s cash-up</Link>
                <ul className="mt-1 text-xs text-muted">{d.cashUps.map((c) => <li key={c.userId}>{c.name}: {c.status === 'NOT_STARTED' ? 'Not started' : c.status === 'SUBMITTED' ? 'Submitted' : 'Signed off'}</li>)}</ul>
              </li>
            )}
            {d.sponsorsOwe.sponsors > 0 && (
              <li>
                <Link href="/finance/sponsors" className="font-semibold text-primary underline">Owed by sponsors</Link>
                <span className="ml-2 tabular-nums text-muted">{CURRENCIES.filter((c) => d.sponsorsOwe.total[c]).map((c) => formatMoney(d.sponsorsOwe.total[c], c)).join(' · ')}</span>
                {d.sponsorsOwe.oldestUnpaidTerm && <div className="text-xs text-muted">Oldest unpaid term: {d.sponsorsOwe.oldestUnpaidTerm}</div>}
              </li>
            )}
          </ul>
        </Section>
      </div>
    </div>
  );
}
