import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { listPayments } from '@/lib/finance/payments';
import { listFunds } from '@/lib/finance/setup';
import { enabledCurrencies, todayInHarare } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProofLink } from '@/components/finance/ProofLink';
import { RecordPaymentModal } from '@/components/finance/RecordPaymentModal';
import { VerifyWithSplits } from '@/components/finance/VerifyWithSplits';
import { Money, Pager, RowAction, Section, StatusBadge, Td, Th, fieldClass, methodLabel } from '@/components/finance/shared';

export const metadata = { title: 'Payments · Pfuma' };

type Params = { status?: string; fundId?: string; currency?: string; from?: string; to?: string; q?: string; page?: string };
const TABS = [['', 'All'], ['PENDING', 'Waiting'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['VOIDED', 'Voided']] as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Params }) {
  const { user, can } = await getAccess();
  if (!can('finance.payments.view') && !can('finance.payments.verify') && !can('finance.payments.record')) return <AccessDenied />;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const status = (['PENDING', 'VERIFIED', 'REJECTED', 'VOIDED'] as const).find((s) => s === searchParams.status);
  const currency = searchParams.currency === 'USD' || searchParams.currency === 'ZIG' ? searchParams.currency : undefined;
  const [list, funds, currencies] = await Promise.all([
    listPayments(user, { status, fundId: searchParams.fundId, currency, from: searchParams.from, to: searchParams.to, q: searchParams.q, page, pageSize: 50 }),
    listFunds(user),
    getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId)),
  ]);
  const qs = (over: Record<string, string>) => `/finance/payments?${new URLSearchParams(Object.fromEntries(Object.entries({ ...searchParams, ...over }).filter(([, v]) => v))).toString()}`;
  const today = todayInHarare();
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Payments" description="A payment counts only after someone other than the person who recorded it has verified it." breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Payments' }]}
        actions={can('finance.payments.record') ? <RecordPaymentModal funds={funds.filter((f) => f.active)} enabledCurrencies={currencies} /> : undefined} />
      <nav className="flex gap-1 overflow-x-auto rounded-full bg-white p-1" aria-label="Status">
        {TABS.map(([v, label]) => <Link key={v} href={qs({ status: v, page: '' })} className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${(status ?? '') === v ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{label}</Link>)}
      </nav>
      <form method="get" className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input type="hidden" name="status" value={status ?? ''} />
        <input name="q" defaultValue={searchParams.q} placeholder="Receipt, reference or student" aria-label="Search" className={`${fieldClass} lg:col-span-2`} />
        <select name="fundId" defaultValue={searchParams.fundId ?? ''} aria-label="Fund" className={fieldClass}><option value="">All funds</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select name="currency" defaultValue={currency ?? ''} aria-label="Currency" className={fieldClass}><option value="">Both currencies</option><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select>
        <input type="date" name="from" defaultValue={searchParams.from} aria-label="From" className={fieldClass} />
        <input type="date" name="to" defaultValue={searchParams.to ?? ''} max={today} aria-label="To" className={fieldClass} />
        <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-sm font-semibold text-white sm:col-span-2 lg:col-span-6">Filter</button>
      </form>
      <Section title={`${list.total} payment${list.total === 1 ? '' : 's'}`}
        action={can('finance.reports.export') ? <a className="text-sm font-semibold text-primary underline" href={`/api/finance/reports/payments?format=csv${searchParams.from ? `&from=${searchParams.from}` : ''}${searchParams.to ? `&to=${searchParams.to}` : ''}${searchParams.fundId ? `&fundId=${searchParams.fundId}` : ''}`}>Download as a spreadsheet</a> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem]">
            <thead><tr><Th>Receipt</Th><Th>Date</Th><Th>Student</Th><Th>Fund</Th><Th>Method</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Recorded / verified by</Th><Th /></tr></thead>
            <tbody>
              {list.rows.map((p) => {
                const mine = p.recordedById === user.id;
                return (
                  <tr key={p.id} className="border-t border-line align-top">
                    <Td><Link className="font-semibold text-primary underline" href={`/finance/payments/${p.id}/receipt`}>{p.receiptNumber ?? p.ackNumber}</Link>{p.reference && <div className="text-xs text-muted">{p.reference}</div>}</Td>
                    <Td>{p.receivedOn}</Td>
                    <Td><Link className="underline" href={`/finance/accounts/${p.studentId}`}>{p.studentName}</Link><div className="text-xs text-muted">{p.admissionNumber}</div></Td>
                    <Td>{p.fundName}</Td><Td>{methodLabel(p.method)}</Td>
                    <Td className="text-right"><Money cents={p.amountCents} currency={p.currency} /></Td>
                    <Td><StatusBadge status={p.voided ? 'VOIDED' : p.status} />{p.voided && p.voidReason && <div className="mt-1 max-w-[12rem] text-xs text-muted">{p.voidReason}</div>}{p.status === 'REJECTED' && p.rejectionReason && <div className="mt-1 max-w-[12rem] text-xs text-muted">{p.rejectionReason}</div>}</Td>
                    <Td><div className="text-xs">{p.recordedBy}</div>{p.verifiedBy && <div className="text-xs text-muted">✓ {p.verifiedBy}</div>}{p.verifierFallback && <Badge variant="warning" label="No other finance person" className="mt-1" />}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {p.hasProof && can('finance.payments.view') && <ProofLink paymentId={p.id} />}
                        {(p.status === 'PENDING' || p.status === 'RECEIVED') && !p.voided && can('finance.payments.verify') && !mine && (
                          <>
                            {can('finance.payments.allocate') && p.fundId !== undefined && !p.guardianId
                              ? <VerifyWithSplits paymentId={p.id} studentId={p.studentId} currency={p.currency} fundId={p.fundId} amountCents={p.amountCents} />
                              : <RowAction label="Verify" variant="primary" url={`/api/finance/payments/${p.id}/verify`} done="Verified" />}
                            <RowAction label="Reject" variant="danger" title="Reject this payment" url={`/api/finance/payments/${p.id}/reject`} reason={{ label: 'Why is it rejected?', min: 5 }} done="Rejected" />
                          </>
                        )}
                        {(p.status === 'PENDING' || p.status === 'RECEIVED') && !p.voided && mine &&<span className="max-w-[10rem] text-xs text-muted">You recorded this, so someone else verifies it.</span>}
                        {p.status === 'VERIFIED' && !p.voided && can('finance.payments.void') && !mine && (
                          <RowAction label="Void" variant="danger" title="Void this payment" url={`/api/finance/payments/${p.id}/void`} reason={{ label: 'Why is it a mistake?', min: 10 }} done="Payment voided" />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {list.rows.length === 0 && <tr><Td className="text-muted">No payments match.</Td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => qs({ page: String(p) })} />
      </Section>
    </div>
  );
}
