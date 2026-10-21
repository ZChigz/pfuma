import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getAccount } from '@/lib/finance/accounts';
import { listFunds } from '@/lib/finance/setup';
import { listPayments } from '@/lib/finance/payments';
import { enabledCurrencies } from '@/lib/finance/common';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RecordPaymentModal } from '@/components/finance/RecordPaymentModal';
import { Money, PrintButton, RowAction, Section, StatusBadge, Td, Th, methodLabel } from '@/components/finance/shared';
import { CURRENCIES, formatMoney } from '@/lib/finance/money';

export const metadata = { title: 'Student account · Pfuma' };

export default async function AccountPage({ params }: { params: { studentId: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.accounts.view') && !can('finance.payments.record') && !can('finance.charges.create') && !can('finance.reports.view')) return <AccessDenied />;
  let a;
  try {
    a = await getAccount(user, params.studentId);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) return <EmptyState title="Student not found" description="That student is not at this school." cta={{ label: 'Student accounts', href: '/finance/accounts' }} />;
    throw e;
  }
  const [funds, pays, currencies] = await Promise.all([
    listFunds(user),
    can('finance.payments.view') || can('finance.payments.record') || can('finance.payments.verify') ? listPayments(user, { studentId: params.studentId, pageSize: 100 }) : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 100 }),
    getScopedDb(user.schoolId, user.id).$tx((tx) => enabledCurrencies(tx, user.schoolId)),
  ]);
  const activeFunds = funds.filter((f) => f.active);
  const fundOptions = activeFunds.map((f) => ({ value: f.id, label: f.name }));
  const openCharges = a.charges.filter((c) => c.outstandingCents > 0).map((c) => ({ chargeId: c.chargeId, description: `${c.description} · ${c.termName}`, fundId: c.fundId, currency: c.currency, outstandingCents: c.outstandingCents }));

  return (
    <div className="flex flex-col gap-4 pb-8 print:gap-2">
      <PageHeader
        title={a.student.name}
        description={`${a.student.admissionNumber}${a.student.className ? ` · ${a.student.className}` : ''}${a.student.boarding === 'BOARDER' ? ' · boarder' : ''}${a.student.status !== 'ACTIVE' ? ` · ${a.student.status.toLowerCase()}` : ''}`}
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Student accounts', href: '/finance/accounts' }, { label: a.student.name }]}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          {can('finance.payments.record') && <RecordPaymentModal funds={activeFunds} student={{ id: a.student.id, name: a.student.name }} charges={openCharges} enabledCurrencies={currencies} />}
          {can('finance.charges.create') && (
            <FormAction label="Add a charge" variant="secondary" size="md" url={`/api/finance/accounts/${a.student.id}/charges`} done="Charge added" intro="Use this for a one-off charge. The term’s fees are charged to everyone together on the Fees page."
              fields={[{ name: 'fundId', label: 'Fund', type: 'select', required: true, options: fundOptions }, { name: 'description', label: 'What it is for', required: true, maxLength: 120 },
                { name: 'currency', label: 'Currency', type: 'select', required: true, initial: currencies[0] ?? 'USD', options: currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' })) }, { name: 'amount', label: 'Amount', type: 'money', required: true }]} />
          )}
          {can('finance.adjustments.create') && (
            <FormAction label="Ask for a discount" variant="secondary" size="md" url="/api/finance/discounts" extra={{ studentId: a.student.id }} done="Asked for. Someone else approves it before it applies."
              intro="A standing discount applies at every billing until it is ended. Leave the fee items empty to cover every recurring fee."
              fields={[
                { name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'STAFF_CHILD', label: 'Staff child' }, { value: 'HARDSHIP', label: 'Hardship waiver' }, { value: 'EARLY_PAYMENT', label: 'Early payment' }, { value: 'HEAD_DISCRETION', label: 'Head’s discretion' }, { value: 'CORRECTION', label: 'Correction' }] },
                { name: 'percent', label: 'Percentage off', type: 'number', hint: 'Or a fixed amount per term below' }, { name: 'amount', label: 'Fixed amount per term', type: 'money' },
                { name: 'currency', label: 'Currency of the fixed amount', type: 'select', options: currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' })) },
                { name: 'standing', label: 'Until ended?', type: 'select', initial: 'false', options: [{ value: 'false', label: 'This term only' }, { value: 'true', label: 'Every term until ended' }] },
                { name: 'reason', label: 'Reason', type: 'textarea', required: true },
              ]} />
          )}
          {can('finance.credit.transfer') && a.credits.length > 0 && (
            <FormAction label="Move credit" variant="secondary" size="md" url="/api/finance/credit/transfer" extra={{ fromStudentId: a.student.id }} done="Credit moved. Someone else verifies it on the other account."
              intro="Moves credit to a brother or sister with the same fee payer."
              fields={[
                { name: 'toStudentId', label: 'To', type: 'student', required: true },
                { name: 'currency', label: 'Currency', type: 'select', required: true, initial: currencies[0] ?? 'USD', options: currencies.map((c) => ({ value: c, label: c === 'USD' ? 'US dollars' : 'ZiG' })) },
                { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true },
              ]} />
          )}
          {can('finance.statements.view') && <a className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-tint" href={`/api/finance/statements/student/${a.student.id}/pdf`}>Statement (PDF)</a>}
          {can('finance.statements.view') && <RowAction label="Text the statement" variant="secondary" url={`/api/finance/statements/student/${a.student.id}/sms`} done="Queued for the fee payer" />}
          <PrintButton label="Print statement" />
        </div>}
      />

      {a.payers.length > 0 && <p className="text-sm text-muted">Fee payer: {a.payers.map((p) => `${p.name} (${p.phone})`).join(' · ')}</p>}

      <Section title="Balance" hint="Charged − approved credit notes − verified payments settled + refunds paid out. A pending payment counts for nothing yet.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr><Th>Currency</Th><Th className="text-right">Charged</Th><Th className="text-right">Credit notes</Th><Th className="text-right">Paid</Th><Th className="text-right">Refunded</Th><Th className="text-right">Owes</Th><Th className="text-right">Credit held</Th></tr></thead>
            <tbody>
              {CURRENCIES.map((c) => (
                <tr key={c} className="border-t border-line">
                  <Td className="font-semibold">{c === 'USD' ? 'US dollars' : 'ZiG'}</Td>
                  <Td className="text-right"><Money cents={a.byCurrency[c].charged} currency={c} /></Td><Td className="text-right"><Money cents={a.byCurrency[c].adjusted} currency={c} /></Td>
                  <Td className="text-right"><Money cents={a.byCurrency[c].paid} currency={c} /></Td><Td className="text-right"><Money cents={a.byCurrency[c].refunded} currency={c} /></Td>
                  <Td className="text-right"><Money cents={a.byCurrency[c].outstanding} currency={c} className="font-semibold" /></Td><Td className="text-right"><Money cents={a.byCurrency[c].credit} currency={c} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.byFund.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead><tr><Th>Fund</Th>{CURRENCIES.map((c) => <Th key={c} className="text-right">Owes ({c === 'USD' ? 'US$' : 'ZiG'})</Th>)}</tr></thead>
              <tbody>{a.byFund.map((f) => <tr key={f.fundId} className="border-t border-line"><Td>{f.fundName}</Td>{CURRENCIES.map((c) => <Td key={c} className="text-right"><Money cents={f.byCurrency[c].outstanding} currency={c} /></Td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Charges">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Charge</Th><Th>Term</Th><Th>Fund</Th><Th className="text-right">Charged</Th><Th className="text-right">Credit notes</Th><Th className="text-right">Paid</Th><Th className="text-right">Owes</Th><Th className="print:hidden" /></tr></thead>
            <tbody>
              {a.charges.map((c) => (
                <tr key={c.chargeId} className="border-t border-line">
                  <Td>{c.description}</Td><Td>{c.termName}</Td><Td>{c.fundName}</Td>
                  <Td className="text-right"><Money cents={c.chargedCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.adjustedCents} currency={c.currency} /></Td>
                  <Td className="text-right"><Money cents={c.paidCents - c.refundedCents} currency={c.currency} /></Td><Td className="text-right"><Money cents={c.outstandingCents} currency={c.currency} className="font-semibold" /></Td>
                  <Td className="print:hidden">
                    <div className="flex flex-wrap justify-end gap-2">
                      {can('finance.adjustments.create') && c.chargedCents - c.adjustedCents > 0 && (
                        <FormAction label="Credit note" title={`Credit note on ${c.description}`} url="/api/finance/adjustments" extra={{ chargeId: c.chargeId }} done="Asked for. A second person must approve it before it lowers the balance."
                          fields={[{ name: 'kind', label: 'Kind', type: 'select', required: true, initial: 'CREDIT_NOTE', options: [{ value: 'CREDIT_NOTE', label: 'Credit note' }, { value: 'DISCOUNT', label: 'Discount' }, { value: 'BURSARY', label: 'Bursary' }, { value: 'WAIVER', label: 'Waiver' }] },
                            { name: 'amount', label: 'Amount', type: 'money', required: true, hint: `Up to ${formatMoney(c.chargedCents - c.adjustedCents, c.currency)}` }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} />
                      )}
                      {can('finance.charges.void') && c.paidCents === 0 && c.adjustedCents === 0 && (
                        <RowAction label="Void" variant="danger" title="Void this charge" url={`/api/finance/charges/${c.chargeId}/void`} reason={{ label: 'Why was it a mistake?', min: 10 }} done="Charge voided" />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {a.charges.length === 0 && <tr><Td className="text-muted">Nothing has been charged yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      {pays.rows.length > 0 && (
        <Section title="Payments">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem]">
              <thead><tr><Th>Receipt</Th><Th>Date</Th><Th>Fund</Th><Th>Method</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th className="print:hidden" /></tr></thead>
              <tbody>
                {pays.rows.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <Td><Link className="text-primary underline" href={`/finance/payments/${p.id}/receipt`}>{p.receiptNumber ?? p.ackNumber}</Link></Td><Td>{p.receivedOn}</Td><Td>{p.fundName}</Td><Td>{methodLabel(p.method)}</Td>
                    <Td className="text-right"><Money cents={p.amountCents} currency={p.currency} /></Td><Td><StatusBadge status={p.voided ? 'VOIDED' : p.status} /></Td>
                    <Td className="print:hidden">
                      {can('finance.refunds.request') && p.status === 'VERIFIED' && !p.voided && (
                        <FormAction label="Refund" title={`Refund on ${p.receiptNumber}`} url="/api/finance/refunds" extra={{ paymentId: p.id }} done="Refund asked for. Another person approves it and a third pays it out."
                          fields={[{ name: 'chargeId', label: 'Take it back from', type: 'select', hint: 'Choose a charge to make it owed again, or leave empty to return unallocated credit.',
                            options: a.charges.filter((c) => c.fundId === p.fundId && c.currency === p.currency && c.paidCents > 0).map((c) => ({ value: c.chargeId, label: `${c.description} · ${c.termName}` })) },
                            { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }]} />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {a.credits.length > 0 && (
        <Section title="Credit on account" hint="Verified money not yet used for a charge. It settles the next charge in the same fund automatically.">
          <ul className="text-sm text-ink">{a.credits.map((c) => <li key={c.paymentId}>{c.receiptNumber} · {c.fundName}: <Money cents={c.creditCents} currency={c.currency} /></li>)}</ul>
        </Section>
      )}

      <Section title="Statement" hint="In date order. Rows in grey do not count yet (waiting, rejected or voided). The running balance is per currency.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Date</Th><Th>Entry</Th><Th>Fund</Th><Th className="text-right">Charged</Th><Th className="text-right">Paid / credited</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
            <tbody>
              {a.statement.map((e) => (
                <tr key={`${e.kind}-${e.id}`} className={`border-t border-line ${e.counts ? '' : 'text-muted'}`}>
                  <Td>{e.at.slice(0, 10)}</Td><Td>{e.description}</Td><Td>{e.fundName}</Td>
                  <Td className="text-right">{e.debitCents ? <Money cents={e.debitCents} currency={e.currency} /> : ''}</Td><Td className="text-right">{e.creditCents ? <Money cents={e.creditCents} currency={e.currency} /> : ''}</Td>
                  <Td className="text-right">{e.counts ? <Money cents={e.runningCents} currency={e.currency} /> : ''}</Td><Td><StatusBadge status={e.status} /></Td>
                </tr>
              ))}
              {a.statement.length === 0 && <tr><Td className="text-muted">No entries yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
