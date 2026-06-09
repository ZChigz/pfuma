'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { ReturnModal } from '@/components/library/ReturnModal';
import { formatDate } from '@/lib/utils';

type BorrowingRow = {
  id: string;
  checkoutDate: string;
  dueDate: string;
  returnDate: string | null;
  fineAmount: number;
  fineSettled: boolean;
  daysOverdue: number;
  conditionOnReturn: string | null;
  member: { user: { fullName: string }; id: string };
  copy: { accessionNumber: string; book: { id: string; title: string } };
  [key: string]: unknown;
};

type Tab = 'active' | 'overdue' | 'history';

export default function BorrowingPage() {
  const [tab,           setTab]           = useState<Tab>('active');
  const [active,        setActive]        = useState<BorrowingRow[]>([]);
  const [history,       setHistory]       = useState<BorrowingRow[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [returnTarget,  setReturnTarget]  = useState<BorrowingRow | null>(null);

  const fetchActive = useCallback(async () => {
    setLoadingActive(true);
    try {
      const res  = await fetch('/api/library/borrowing');
      const data = await res.json();
      if (res.ok) setActive(data.data.borrowings ?? []);
    } finally {
      setLoadingActive(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res  = await fetch('/api/library/borrowing?history=true');
      const data = await res.json();
      if (res.ok) {
        setHistory(data.data.borrowings ?? []);
        setHistoryLoaded(true);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { fetchActive(); }, [fetchActive]);

  function handleTabChange(next: Tab) {
    setTab(next);
    if (next === 'history' && !historyLoaded) fetchHistory();
  }

  const now     = new Date();
  const overdue = active.filter((b) => b.daysOverdue > 0);

  const shownRows = tab === 'active'  ? active
                  : tab === 'overdue' ? overdue
                  : history;

  const loading = tab === 'history' ? loadingHistory : loadingActive;

  const columns = [
    {
      key: 'member',
      label: 'Member',
      render: (row: BorrowingRow) => (row.member as BorrowingRow['member']).user.fullName,
    },
    {
      key: 'book',
      label: 'Book',
      render: (row: BorrowingRow) => (row.copy as BorrowingRow['copy']).book.title,
    },
    {
      key: 'accession',
      label: 'Accession',
      render: (row: BorrowingRow) => (
        <span className="font-mono text-xs text-[#78716c]">
          {(row.copy as BorrowingRow['copy']).accessionNumber}
        </span>
      ),
    },
    {
      key: 'checkoutDate',
      label: 'Checked Out',
      render: (row: BorrowingRow) => formatDate(row.checkoutDate),
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      render: (row: BorrowingRow) => formatDate(row.dueDate),
    },
    ...(tab === 'overdue' ? [
      {
        key: 'daysOverdue',
        label: 'Days Overdue',
        render: (row: BorrowingRow) => (
          <span className="font-semibold text-[#b91c1c]">{row.daysOverdue}d</span>
        ),
      },
      {
        key: 'estimatedFine',
        label: 'Est. Fine',
        render: (row: BorrowingRow) => {
          const rate = parseFloat(process.env.NEXT_PUBLIC_DAILY_FINE_RATE ?? '0');
          const fine = row.daysOverdue * rate;
          return fine > 0 ? (
            <span className="font-medium text-[#b91c1c]">${fine.toFixed(2)}</span>
          ) : '—';
        },
      },
    ] : []),
    ...(tab === 'history' ? [
      {
        key: 'returnDate',
        label: 'Returned',
        render: (row: BorrowingRow) =>
          row.returnDate ? formatDate(row.returnDate) : (
            <Badge variant="warning" label="Active" />
          ),
      },
      {
        key: 'fineAmount',
        label: 'Fine',
        render: (row: BorrowingRow) =>
          row.fineAmount > 0 ? (
            <span className={row.fineSettled ? 'text-[#78716c] line-through' : 'font-medium text-[#b91c1c]'}>
              ${row.fineAmount.toFixed(2)}
            </span>
          ) : '—',
      },
    ] : []),
    ...(tab !== 'history' ? [
      {
        key: 'action',
        label: '',
        render: (row: BorrowingRow) => (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => { e.stopPropagation(); setReturnTarget(row); }}
          >
            Return
          </Button>
        ),
      },
    ] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Borrowing</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Track book checkouts and returns</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-[#e7e5e4] bg-[#f5f5f4] p-1 self-start">
        {(['active', 'overdue', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={[
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === t
                ? 'bg-white text-[#292524] shadow-sm'
                : 'text-[#78716c] hover:text-[#292524]',
            ].join(' ')}
          >
            {t === 'active'  ? `Active (${active.length})` :
             t === 'overdue' ? `Overdue (${overdue.length})` :
             'All History'}
          </button>
        ))}
      </div>

      {/* Overdue warning */}
      {tab === 'overdue' && overdue.length > 0 && (
        <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          {overdue.length} borrowing{overdue.length !== 1 ? 's are' : ' is'} past the due date.
          Contact members to arrange returns.
        </div>
      )}

      <Table
        columns={columns as never}
        data={shownRows}
        loading={loading}
        emptyMessage={
          tab === 'active'  ? 'No active borrowings.' :
          tab === 'overdue' ? 'No overdue borrowings.' :
          'No borrowing history.'
        }
      />

      <ReturnModal
        borrowing={returnTarget ?? undefined}
        open={returnTarget !== null}
        onClose={() => setReturnTarget(null)}
        onSuccess={() => { setReturnTarget(null); fetchActive(); if (historyLoaded) fetchHistory(); }}
      />
    </div>
  );
}
