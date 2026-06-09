'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { CheckoutModal } from '@/components/library/CheckoutModal';
import { ReturnModal } from '@/components/library/ReturnModal';
import { formatDate } from '@/lib/utils';
import type { UserRole } from '@/types';

type OverdueItem = {
  id: string;
  bookTitle: string;
  accession: string;
  memberName: string;
  dueDate: string;
  daysOverdue: number;
};

interface Props {
  stats: {
    totalTitles: number;
    available:   number;
    borrowed:    number;
    overdue:     number;
  };
  overdueList: OverdueItem[];
  userRole:    UserRole;
}

export function LibraryOverviewClient({ stats, overdueList, userRole }: Props) {
  const router = useRouter();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showReturn,   setShowReturn]   = useState(false);

  const canManage = ['DIRECTOR', 'HEAD', 'LIBRARIAN'].includes(userRole);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Library</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Book catalog and borrowing management</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowReturn(true)}>
              Return Book
            </Button>
            <Button onClick={() => setShowCheckout(true)}>
              Checkout Book
            </Button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Titles',       value: stats.totalTitles, color: '#292524' },
          { label: 'Available Copies',   value: stats.available,   color: '#065f46' },
          { label: 'Currently Borrowed', value: stats.borrowed,    color: '#d97706' },
          { label: 'Overdue',            value: stats.overdue,     color: stats.overdue > 0 ? '#b91c1c' : '#78716c' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-[#e7e5e4] bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-5 w-5 flex-shrink-0 text-[#d97706]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <p className="font-semibold text-[#92400e]">
              {overdueList.length} overdue borrowing{overdueList.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-[#92400e]">
              <thead>
                <tr className="border-b border-[#fde68a]">
                  {['Member', 'Book', 'Accession', 'Due Date', 'Days Overdue'].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#fde68a]">
                {overdueList.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-4 font-medium">{item.memberName}</td>
                    <td className="py-2 pr-4">{item.bookTitle}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{item.accession}</td>
                    <td className="py-2 pr-4">{formatDate(item.dueDate)}</td>
                    <td className="py-2 font-bold text-[#b91c1c]">{item.daysOverdue}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick access */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Quick Access</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: '/library/catalog',   label: 'Book Catalog',  desc: 'Browse and manage books'    },
            { href: '/library/borrowing', label: 'Borrowing',     desc: 'Active and history records' },
          ].map(({ href, label, desc }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="rounded-xl border border-[#e7e5e4] bg-white p-4 text-left transition-shadow hover:shadow-md"
            >
              <p className="font-semibold text-[#292524]">{label}</p>
              <p className="mt-0.5 text-xs text-[#78716c]">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Modals */}
      <CheckoutModal
        open={showCheckout}
        onClose={() => setShowCheckout(false)}
        onSuccess={() => { setShowCheckout(false); router.refresh(); }}
      />
      <ReturnModal
        open={showReturn}
        onClose={() => setShowReturn(false)}
        onSuccess={() => { setShowReturn(false); router.refresh(); }}
      />
    </div>
  );
}
