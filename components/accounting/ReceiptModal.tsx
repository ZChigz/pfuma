'use client';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatUSD, formatZiG, formatDateTime, buildWhatsAppLink } from '@/lib/utils';
import type { ReceiptData } from './PaymentModal';

interface Props {
  open: boolean;
  receipt: ReceiptData;
  onClose: () => void;
}

export function ReceiptModal({ open, receipt, onClose }: Props) {
  const amountStr =
    receipt.currency === 'USD'
      ? formatUSD(receipt.amount)
      : formatZiG(receipt.amount);

  const receiptText = [
    `--- Receipt | ${receipt.schoolName} ---`,
    `Student: ${receipt.studentFullName} (${receipt.studentGrade})`,
    `Fee: ${receipt.feeLabel}`,
    `Amount: ${amountStr}`,
    receipt.paidInZig && receipt.zigAmountPaid && receipt.exchangeRateUsed
      ? `Paid in ZiG: ${formatZiG(receipt.zigAmountPaid)} @ 1 USD = ZiG ${receipt.exchangeRateUsed.toFixed(2)}`
      : null,
    `Method: ${receipt.method}`,
    receipt.reference ? `Reference: ${receipt.reference}` : null,
    `Date: ${formatDateTime(receipt.recordedAt)}`,
    `Status: ${receipt.status}`,
    `Balance USD: ${formatUSD(receipt.balanceUSD)}`,
    `Balance ZiG: ${formatZiG(receipt.balanceZiG)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const waLink = buildWhatsAppLink(receipt.studentParentPhone, receiptText);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Payment Receipt"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => window.open(waLink, '_blank', 'noopener,noreferrer')}
          >
            {/* WhatsApp icon */}
            <svg className="mr-1.5 h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Share to WhatsApp
          </Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="rounded-xl border border-[#e7e5e4] bg-[#f5f5f4] p-5">
        {/* School name header */}
        <p className="mb-4 text-center text-xs font-bold uppercase tracking-widest text-[#065f46]">
          {receipt.schoolName}
        </p>

        {/* Student + status */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-[#292524]">{receipt.studentFullName}</p>
            <p className="text-sm text-[#78716c]">{receipt.studentGrade}</p>
          </div>
          <Badge
            variant={receipt.status === 'VERIFIED' ? 'success' : 'warning'}
            label={receipt.status === 'VERIFIED' ? 'Verified' : 'Awaiting verification'}
          />
        </div>

        {/* Line items */}
        <div className="divide-y divide-[#e7e5e4]">
          <ReceiptRow label="Fee" value={receipt.feeLabel} />
          <ReceiptRow label="Amount" value={amountStr} bold />
          <ReceiptRow label="Method" value={receipt.method} />
          {receipt.reference && <ReceiptRow label="Reference" value={receipt.reference} />}
          <ReceiptRow label="Date" value={formatDateTime(receipt.recordedAt)} />
        </div>

        {/* ZiG conversion proof */}
        {receipt.paidInZig && receipt.zigAmountPaid && receipt.exchangeRateUsed && (
          <div className="mt-3 rounded-lg border border-[#f59e0b] bg-[#fef9c3] p-3">
            <p className="text-xs font-semibold text-[#92400e]">Payment received in ZiG</p>
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#78716c]">ZiG received</span>
                <span className="font-medium text-[#292524]">{formatZiG(receipt.zigAmountPaid)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#78716c]">Exchange rate</span>
                <span className="font-medium text-[#292524]">1 USD = ZiG {receipt.exchangeRateUsed.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#78716c]">USD equivalent</span>
                <span className="font-medium text-[#292524]">{formatUSD(receipt.amount)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Remaining balances */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <BalanceCard label="Remaining USD" value={formatUSD(receipt.balanceUSD)} isOwing={receipt.balanceUSD > 0} />
          <BalanceCard label="Remaining ZiG" value={formatZiG(receipt.balanceZiG)} isOwing={receipt.balanceZiG > 0} />
        </div>
      </div>
    </Modal>
  );
}

function ReceiptRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[#78716c]">{label}</span>
      <span className={`text-sm ${bold ? 'font-bold text-[#292524]' : 'text-[#292524]'}`}>{value}</span>
    </div>
  );
}

function BalanceCard({ label, value, isOwing }: { label: string; value: string; isOwing: boolean }) {
  return (
    <div className="rounded-lg border border-[#e7e5e4] bg-white p-3 text-center">
      <p className="text-xs text-[#78716c]">{label}</p>
      <p className={`mt-0.5 font-bold tabular-nums ${isOwing ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
        {value}
      </p>
    </div>
  );
}
