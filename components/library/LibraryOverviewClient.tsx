'use client';

import { StatCard } from '@/components/ui/StatCard';
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
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Library</h1>
          <p className="mt-1 text-sm text-muted">Book catalog and borrowing management</p>
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
        <StatCard label="Available copies" value={stats.available} hero />
        <StatCard label="Titles in catalog" value={stats.totalTitles} href="/library/catalog" />
        <StatCard label="Currently borrowed" value={stats.borrowed} href="/library/borrowing" />
        <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : 'default'} note={stats.overdue > 0 ? 'Follow up with members' : 'Nothing overdue'} />
      </div>

      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div className="rounded-2xl border border-warn-line bg-warn-bg p-4">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-5 w-5 flex-shrink-0 text-warn" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <p className="font-semibold text-warn">
              {overdueList.length} overdue borrowing{overdueList.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-warn">
              <thead>
                <tr className="border-b border-warn-line">
                  {['Member', 'Book', 'Accession', 'Due Date', 'Days Overdue'].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-left text-xs font-medium ">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-warn-line">
                {overdueList.map((item) => (
                  <tr key={item.id}>
                    <td className="py-2 pr-4 font-medium">{item.memberName}</td>
                    <td className="py-2 pr-4">{item.bookTitle}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{item.accession}</td>
                    <td className="py-2 pr-4">{formatDate(item.dueDate)}</td>
                    <td className="py-2 font-bold text-danger">{item.daysOverdue}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick access */}
      <div>
        <p className="mb-3 text-xs font-medium text-muted">Quick Access</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { href: '/library/catalog',   label: 'Book Catalog',  desc: 'Browse and manage books'    },
            { href: '/library/borrowing', label: 'Borrowing',     desc: 'Active and history records' },
          ].map(({ href, label, desc }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="rounded-2xl bg-white p-5 text-left transition-shadow hover:shadow-md"
            >
              <p className="font-semibold text-ink">{label}</p>
              <p className="mt-0.5 text-xs text-muted">{desc}</p>
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
