'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';

type BorrowingData = {
  id: string;
  checkoutDate: string;
  dueDate: string;
  fineAmount: number;
  daysOverdue: number;
  member: { user: { fullName: string } };
  copy: {
    accessionNumber: string;
    book: { title: string };
  };
};

const CONDITION_OPTIONS = [
  { value: 'NEW',     label: 'New — perfect condition'  },
  { value: 'GOOD',    label: 'Good — minor wear'         },
  { value: 'FAIR',    label: 'Fair — visible wear'       },
  { value: 'DAMAGED', label: 'Damaged — needs repair'    },
];

interface Props {
  borrowing?: BorrowingData;
  open:       boolean;
  onClose:    () => void;
  onSuccess:  () => void;
}

export function ReturnModal({ borrowing: propBorrowing, open, onClose, onSuccess }: Props) {
  const toast = useToast();

  // Search step (when no borrowing is pre-loaded)
  const [accessionSearch, setAccessionSearch] = useState('');
  const [searching,       setSearching]       = useState(false);
  const [searchError,     setSearchError]     = useState('');
  const [foundBorrowing,  setFoundBorrowing]  = useState<BorrowingData | null>(null);

  const [condition,    setCondition]    = useState('GOOD');
  const [fineSettled,  setFineSettled]  = useState(false);
  const [submitting,   setSubmitting]   = useState(false);

  const activeBorrowing = propBorrowing ?? foundBorrowing;
  const dailyRate = parseFloat(process.env.NEXT_PUBLIC_DAILY_FINE_RATE ?? '0');

  // Reset when modal opens/closes
  useEffect(() => {
    if (!open) {
      setAccessionSearch('');
      setFoundBorrowing(null);
      setSearchError('');
      setCondition('GOOD');
      setFineSettled(false);
    }
  }, [open]);

  async function handleSearch() {
    if (!accessionSearch.trim()) return;
    setSearching(true);
    setSearchError('');
    try {
      const res  = await fetch(`/api/library/borrowing?accession=${encodeURIComponent(accessionSearch.trim())}`);
      const data = await res.json();
      if (!res.ok) { setSearchError('Could not search borrowings'); return; }
      const list: BorrowingData[] = data.data.borrowings ?? [];
      const active = list.find((b) => !b.copy?.book); // fallback guard
      const found  = list[0] ?? null;
      if (!found) {
        setSearchError(`No active borrowing found for accession "${accessionSearch}"`);
      } else {
        setFoundBorrowing(found);
      }
    } finally { setSearching(false); }
  }

  async function handleReturn() {
    if (!activeBorrowing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/library/borrowing/${activeBorrowing.id}/return`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          conditionOnReturn: condition,
          fineSettled: activeBorrowing.daysOverdue > 0 ? fineSettled : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message ?? 'Return failed'); return; }
      toast.success('Book returned successfully');
      onSuccess();
    } finally { setSubmitting(false); }
  }

  const estimatedFine = activeBorrowing
    ? (activeBorrowing.daysOverdue > 0 ? activeBorrowing.daysOverdue * dailyRate : 0)
    : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Return Book"
      size="md"
      footer={
        !activeBorrowing ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSearch} loading={searching} disabled={!accessionSearch.trim()}>
              Find Borrowing
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => { setFoundBorrowing(null); setAccessionSearch(''); }}
              disabled={submitting || !!propBorrowing}
            >
              {propBorrowing ? 'Cancel' : 'Back'}
            </Button>
            <Button onClick={handleReturn} loading={submitting}>
              Confirm Return
            </Button>
          </>
        )
      }
    >
      {!activeBorrowing ? (
        /* ── Search step ─────────────────────────────────────────── */
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#78716c]">
            Enter the accession number printed on the book to look up the active borrowing.
          </p>
          <Input
            id="accession-search"
            label="Accession Number"
            placeholder="e.g. SCH-2024-0001"
            value={accessionSearch}
            onChange={(e) => { setAccessionSearch(e.target.value); setSearchError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          />
          {searchError && (
            <p className="text-sm text-[#b91c1c]">{searchError}</p>
          )}
        </div>
      ) : (
        /* ── Return form ──────────────────────────────────────────── */
        <div className="flex flex-col gap-4">
          {/* Borrowing info */}
          <div className="divide-y divide-[#e7e5e4] rounded-lg border border-[#e7e5e4]">
            {[
              { label: 'Book',        value: activeBorrowing.copy.book.title           },
              { label: 'Accession',   value: activeBorrowing.copy.accessionNumber      },
              { label: 'Member',      value: activeBorrowing.member.user.fullName      },
              { label: 'Checked Out', value: formatDate(activeBorrowing.checkoutDate)  },
              { label: 'Due Date',    value: formatDate(activeBorrowing.dueDate)       },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</span>
                <span className="text-sm text-[#292524]">{value}</span>
              </div>
            ))}
          </div>

          {/* Overdue banner */}
          {activeBorrowing.daysOverdue > 0 && (
            <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3">
              <p className="font-semibold text-[#92400e]">
                {activeBorrowing.daysOverdue} day{activeBorrowing.daysOverdue !== 1 ? 's' : ''} overdue
              </p>
              {estimatedFine > 0 && (
                <p className="mt-0.5 text-sm text-[#92400e]">
                  Estimated fine: <span className="font-bold">${estimatedFine.toFixed(2)}</span>
                </p>
              )}
            </div>
          )}

          {/* Condition */}
          <Select
            id="condition"
            label="Condition on Return"
            required
            options={CONDITION_OPTIONS}
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
          />

          {/* Fine settled */}
          {estimatedFine > 0 && (
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={fineSettled}
                onChange={(e) => setFineSettled(e.target.checked)}
                className="h-4 w-4 rounded border-[#e7e5e4] accent-[#065f46]"
              />
              <span className="text-sm text-[#292524]">Fine of ${estimatedFine.toFixed(2)} has been settled</span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
