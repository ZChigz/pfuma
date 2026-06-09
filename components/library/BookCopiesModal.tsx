'use client';

import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import type { CopyCondition, CopyStatus } from '@/types';

type Copy = {
  id: string;
  accessionNumber: string;
  condition: CopyCondition;
  status: CopyStatus;
};

type Book = {
  id: string;
  title: string;
  author: string;
  subject?: string | null;
  publisher?: string | null;
  year?: number | null;
  shelfLocation?: string | null;
  isbn?: string | null;
  copies: Copy[];
  availableCopiesCount: number;
};

interface Props {
  book:    Book | null;
  onClose: () => void;
}

function conditionBadge(c: CopyCondition) {
  const map: Record<CopyCondition, 'success' | 'warning' | 'danger' | 'neutral'> = {
    NEW: 'success', GOOD: 'success', FAIR: 'warning', DAMAGED: 'danger',
  };
  return <Badge variant={map[c] ?? 'neutral'} label={c.charAt(0) + c.slice(1).toLowerCase()} />;
}

function statusBadge(s: CopyStatus) {
  const map: Record<CopyStatus, 'success' | 'warning' | 'neutral'> = {
    AVAILABLE: 'success', BORROWED: 'warning', LOST: 'neutral',
  };
  const labels: Record<CopyStatus, string> = {
    AVAILABLE: 'Available', BORROWED: 'Borrowed', LOST: 'Lost',
  };
  return <Badge variant={map[s] ?? 'neutral'} label={labels[s] ?? s} />;
}

export function BookCopiesModal({ book, onClose }: Props) {
  if (!book) return null;

  return (
    <Modal
      open={book !== null}
      onClose={onClose}
      title={book.title}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {/* Book meta */}
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
          {[
            { label: 'Author',    value: book.author },
            { label: 'Subject',   value: book.subject    ?? '—' },
            { label: 'Publisher', value: book.publisher  ?? '—' },
            { label: 'Year',      value: book.year?.toString() ?? '—' },
            { label: 'Shelf',     value: book.shelfLocation ?? '—' },
            { label: 'ISBN',      value: book.isbn ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-2">
              <span className="w-20 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                {label}
              </span>
              <span className="text-[#292524]">{value}</span>
            </div>
          ))}
        </div>

        <hr className="border-[#e7e5e4]" />

        {/* Copies */}
        <div>
          <p className="mb-3 text-sm font-semibold text-[#292524]">
            Copies — {book.availableCopiesCount} of {book.copies.length} available
          </p>
          {book.copies.length === 0 ? (
            <p className="text-sm text-[#78716c]">No copies registered.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#e7e5e4]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                  <tr>
                    {['Accession', 'Condition', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e5e4]">
                  {book.copies.map((copy) => (
                    <tr key={copy.id} className="bg-white">
                      <td className="px-4 py-2.5 font-mono text-xs text-[#78716c]">
                        {copy.accessionNumber}
                      </td>
                      <td className="px-4 py-2.5">{conditionBadge(copy.condition)}</td>
                      <td className="px-4 py-2.5">{statusBadge(copy.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
