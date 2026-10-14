'use client';

import { StatCard } from '@/components/ui/StatCard';
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
        <span className="whitespace-nowrap text-muted">{formatDate(row.date)}</span>
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
            <p className="text-xs text-muted">
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
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3">
        <p className="mr-2 text-xs font-medium   text-muted">Portal link</p>
        <span className="flex-1 truncate text-sm text-ink">{portalUrl}</span>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy link'}
        </Button>
        {canApplyCharge && <ApplyChargeModal studentId={studentId} />}
      </div>

      {/* Balance cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard hero label="USD balance" value={formatUSD(balanceUSD)} note={balanceUSD <= 0 ? 'Account cleared' : 'Outstanding balance'} />
        <StatCard label="ZiG balance" value={formatZiG(balanceZiG)} tone={balanceZiG > 0 ? 'danger' : 'default'} note={balanceZiG <= 0 ? 'Account cleared' : 'Outstanding balance'} />

      </div>
      {/* Statement table */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-ink">Account Statement</h2>
        <Table<StatementItem>
          columns={columns}
          data={statement}
          emptyMessage="No transactions recorded yet."
        />
      </div>
    </div>
  );
}
