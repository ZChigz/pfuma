import { getAccess } from '@/lib/access';
import { getReceipt } from '@/lib/finance/payments';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { EmptyState } from '@/components/ui/EmptyState';
import { PrintButton, methodLabel } from '@/components/finance/shared';
import { formatMoney } from '@/lib/finance/money';

export const metadata = { title: 'Receipt · Pfuma' };

export default async function ReceiptPage({ params }: { params: { id: string } }) {
  const { user, can } = await getAccess();
  if (!can('finance.payments.view') && !can('finance.payments.record') && !can('finance.payments.verify')) return <AccessDenied />;
  let r;
  try {
    r = await getReceipt(user, params.id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) return <EmptyState title="Receipt not found" cta={{ label: 'Payments', href: '/finance/payments' }} />;
    throw e;
  }
  const counted = r.status === 'VERIFIED' && !r.voided;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PrintButton label="Print receipt" />
        <a className="text-sm font-semibold text-primary underline" href={`/api/finance/payments/${r.id}/receipt?size=A4`}>PDF (A4)</a>
        <a className="text-sm font-semibold text-primary underline" href={`/api/finance/payments/${r.id}/receipt?size=80mm`}>Till slip 80 mm</a>
        <a className="text-sm font-semibold text-primary underline" href={`/api/finance/payments/${r.id}/receipt?size=58mm`}>Till slip 58 mm</a>
      </div>
      <article className="rounded-2xl bg-white p-6 print:rounded-none print:p-0" aria-label={`Receipt ${r.receiptNumber ?? r.ackNumber}`}>
        <header className="border-b border-line pb-3 text-center">
          <h1 className="text-lg font-bold text-ink">{r.school}</h1>
          {(r.schoolAddress || r.schoolPhone) && <p className="text-sm text-muted">{[r.schoolAddress, r.schoolPhone].filter(Boolean).join(' · ')}</p>}
          <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{r.receiptNumber ? `Receipt ${r.receiptNumber}` : `Acknowledgement ${r.ackNumber} (official receipt follows verification)`}</p>
        </header>
        <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Received from</dt><dd className="text-ink">{r.paidBy ?? '—'}</dd>
          <dt className="text-muted">For student</dt><dd className="font-semibold text-ink">{r.studentName} ({r.admissionNumber})</dd>
          <dt className="text-muted">Date</dt><dd className="text-ink">{r.receivedOn}</dd>
          <dt className="text-muted">Fund</dt><dd className="text-ink">{r.fundName}</dd>
          <dt className="text-muted">Paid by</dt><dd className="text-ink">{methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ''}</dd>
          <dt className="text-muted">Amount</dt><dd className="text-xl font-bold tabular-nums text-ink">{formatMoney(r.amountCents, r.currency)}</dd>
          {r.zig && <><dt className="text-muted">Received</dt><dd className="text-ink">ZiG {(r.zig.zigAmountCents / 100).toFixed(2)} at {r.zig.rate} = {formatMoney(r.amountCents, r.currency)}</dd></>}
          {(['USD', 'ZIG'] as const).filter((c) => r.balanceRemaining[c] > 0).map((c) => <><dt key={`l${c}`} className="text-muted">Balance remaining</dt><dd key={`v${c}`} className="text-ink">{formatMoney(r.balanceRemaining[c], c)}</dd></>)}
        </dl>
        {r.allocations.length > 0 && (
          <div className="mt-4 text-sm"><p className="font-semibold text-ink">Settles</p><ul>{r.allocations.map((a, i) => <li key={i} className="flex justify-between"><span>{a.description}</span><span className="tabular-nums">{formatMoney(a.amountCents, r.currency)}</span></li>)}</ul></div>
        )}
        <footer className="mt-4 border-t border-line pt-3 text-xs text-muted">
          <p>Recorded by {r.recordedBy}{r.verifiedBy ? `, verified by ${r.verifiedBy}` : ''}.</p>
          {!counted && <p className="mt-1 font-semibold text-warn">{r.voided ? 'This receipt was voided.' : r.status === 'REJECTED' ? 'This payment was rejected.' : 'Not yet verified: this payment does not count until a second person verifies it.'}</p>}
        </footer>
      </article>
    </div>
  );
}
