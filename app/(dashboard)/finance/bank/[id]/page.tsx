import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getStatement } from '@/lib/finance/bank';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { FormAction } from '@/components/finance/FormAction';
import { RowAction, Section, StatusBadge, Td, Th } from '@/components/finance/shared';
import { METHOD_OPTIONS, Money } from '@/components/finance/format';

export const metadata = { title: 'Bank statement · Pfuma' };

export default async function StatementPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.bank.reconcile')) return <AccessDenied />;
  let s;
  try { s = await getStatement(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status === 404) notFound(); throw e; }
  const matched = s.lines.filter((l) => l.status === 'MATCHED');
  const open = s.lines.filter((l) => l.status === 'UNMATCHED');
  const waiting = s.notInBank.filter((n) => n.kind === 'PAYMENT');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title={`${s.account}: ${s.from} to ${s.to}`} description={`${s.fileName}. ${matched.length} matched, ${open.length} in the bank but not in the system, ${s.notInBank.length} in the system but not in the bank.`}
        breadcrumbs={[{ label: 'Finance', href: '/finance' }, { label: 'Bank reconciliation', href: '/finance/bank' }, { label: s.account }]} />
      <Section title={`In the bank, not in the system (${open.length})`} hint="Money the bank shows that no payment explains. Make a payment from the line, match it to a payment that is already recorded, or set it aside with a reason (bank charges, interest).">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem]">
            <thead><tr><Th>Date</Th><Th>Reference</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <Td>{l.date}</Td><Td>{l.reference ?? '—'}</Td><Td className="max-w-[16rem]">{l.description}</Td><Td className="text-right"><Money cents={l.amountCents} currency={s.currency} className={l.amountCents < 0 ? 'text-danger' : ''} /></Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {l.amountCents > 0 && (
                        <FormAction label="Make a payment" size="sm" variant="primary" url={`/api/finance/bank/lines/${l.id}/payment`} done="Payment recorded. Someone else verifies it." intro="Records a payment dated as the bank shows it, for the learner chosen."
                          fields={[{ name: 'studentId', label: 'Learner', type: 'student', required: true }, { name: 'method', label: 'Paid by', type: 'select', required: true, initial: 'BANK_TRANSFER', options: METHOD_OPTIONS }]} />
                      )}
                      {l.amountCents > 0 && waiting.length > 0 && (
                        <RowAction label="Match" variant="secondary" title="Match to a payment already recorded" url={`/api/finance/bank/lines/${l.id}/match`}
                          fields={[{ name: 'paymentId', label: 'Payment', options: waiting.map((w) => ({ value: w.id, label: `${w.receipt ?? ''} ${w.student ?? ''} ${(w.cents / 100).toFixed(2)} (${w.date})` })) }]} done="Matched" />
                      )}
                      <RowAction label="Set aside" variant="ghost" url={`/api/finance/bank/lines/${l.id}/ignore`} reason={{ label: 'Why? (bank charges, interest ...)', min: 5 }} done="Set aside" />
                    </div>
                  </Td>
                </tr>
              ))}
              {open.length === 0 && <tr><Td className="text-muted">Every line is matched or set aside.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`In the system, not in the bank (${s.notInBank.length})`} hint="Payments or deposit slips in this period that the statement does not show. They may be late, or recorded wrongly.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead><tr><Th>Date</Th><Th>What</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {s.notInBank.map((n) => <tr key={n.id} className="border-t border-line"><Td>{n.date}</Td><Td>{n.kind === 'PAYMENT' ? `${n.receipt ?? ''} ${n.student ?? ''}` : 'Sponsor payment'}</Td><Td>{n.reference ?? '—'}</Td><Td className="text-right"><Money cents={n.cents} currency={s.currency} /></Td></tr>)}
              {s.notInBank.length === 0 && <tr><Td className="text-muted">Everything recorded appears in the bank.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`Matched (${matched.length})`}>
        <table className="w-full min-w-[34rem]">
          <tbody>
            {matched.map((l) => <tr key={l.id} className="border-t border-line"><Td>{l.date}</Td><Td>{l.reference ?? '—'}</Td><Td className="text-right"><Money cents={l.amountCents} currency={s.currency} /></Td><Td><StatusBadge status="MATCHED" /></Td></tr>)}
          </tbody>
        </table>
      </Section>
      <p className="text-sm"><Link className="underline" href="/finance/bank">All statements</Link></p>
    </div>
  );
}
