'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, type Column } from '@/components/ui/Table';
import { ApplyChargeModal } from './ApplyChargeModal';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import type { PaymentStatus } from '@/types';

export interface StatementItem {
  id: string;
  date: string; // ISO string — Decimal→number and Date→string before crossing RSC boundary
  type: 'Charge' | 'Payment';
  label: string;
  currency: 'USD' | 'ZIG';
  amount: number;
  status?: PaymentStatus;
  method?: string;
  paidInZig?: boolean;
  zigAmountPaid?: number | null;
  exchangeRateUsed?: number | null;
}

interface Props {
  studentId: string;
  portalUrl: string;
  balanceUSD: number;
  balanceZiG: number;
  statement: StatementItem[];
  canApplyCharge: boolean;
}

const STATUS_VARIANT: Record<PaymentStatus, 'success' | 'warning' | 'neutral'> = {
  VERIFIED: 'success',
  PENDING:  'warning',
  VOIDED:   'neutral',
};

export function StudentDetailClient({
  studentId,
  portalUrl,
  balanceUSD,
  balanceZiG,
  statement,
  canApplyCharge,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const columns: Column<StatementItem>[] = [
    {
      key: 'date',
      label: 'Date',
      render: (row) => (
        <span className="whitespace-nowrap text-[#78716c]">{formatDate(row.date)}</span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => (
        <Badge
          variant={row.type === 'Charge' ? 'warning' : 'success'}
          label={row.type}
        />
      ),
    },
    { key: 'label', label: 'Description' },
    { key: 'currency', label: 'Ccy' },
    {
      key: 'amount',
      label: 'Amount',
      render: (row) => (
        <div>
          <span className="tabular-nums font-medium">
            {row.currency === 'USD' ? formatUSD(row.amount) : formatZiG(row.amount)}
          </span>
          {row.paidInZig && row.zigAmountPaid && row.exchangeRateUsed && (
            <p className="text-xs text-[#78716c]">
              {formatZiG(row.zigAmountPaid)} @ {row.exchangeRateUsed.toFixed(2)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) =>
        row.status ? (
          <Badge variant={STATUS_VARIANT[row.status]} label={row.status} />
        ) : (
          <Badge variant="gold" label="Issued" />
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Portal link + charge action */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e7e5e4] bg-white px-4 py-3">
        <p className="mr-2 text-xs font-medium uppercase tracking-wide text-[#78716c]">Portal link</p>
        <span className="flex-1 truncate text-sm text-[#292524]">{portalUrl}</span>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy link'}
        </Button>
        {canApplyCharge && <ApplyChargeModal studentId={studentId} />}
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border-2 border-[#065f46] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#78716c]">USD Balance</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${balanceUSD > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
            {formatUSD(balanceUSD)}
          </p>
          <p className="mt-0.5 text-xs text-[#78716c]">
            {balanceUSD <= 0 ? 'Account cleared' : 'Outstanding balance'}
          </p>
        </div>
        <div className="rounded-xl border-2 border-[#f59e0b] bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#78716c]">ZiG Balance</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${balanceZiG > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
            {formatZiG(balanceZiG)}
          </p>
          <p className="mt-0.5 text-xs text-[#78716c]">
            {balanceZiG <= 0 ? 'Account cleared' : 'Outstanding balance'}
          </p>
        </div>
      </div>

      {/* Statement table */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-[#292524]">Account Statement</h2>
        <Table<StatementItem>
          columns={columns}
          data={statement}
          emptyMessage="No transactions recorded yet."
        />
      </div>
    </div>
  );
}
