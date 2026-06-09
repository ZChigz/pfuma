'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, type Column } from '@/components/ui/Table';
import { formatUSD, formatZiG } from '@/lib/utils';
import { PaymentModal, type ReceiptData } from './PaymentModal';
import { ReceiptModal } from './ReceiptModal';

export interface StudentRow {
  id: string;
  fullName: string;
  grade: string;
  parentName: string;
  parentPhone: string;
  balanceUSD: number;
  balanceZiG: number;
  overdueDays: number;
}

interface Props {
  students: StudentRow[];
  canManage: boolean;
}

export function StudentsTableClient({ students, canManage }: Props) {
  const router = useRouter();
  const [paymentStudent, setPaymentStudent] = useState<StudentRow | null>(null);
  const [receipt, setReceipt]               = useState<ReceiptData | null>(null);

  const columns: Column<StudentRow>[] = [
    { key: 'fullName',    label: 'Name'   },
    { key: 'grade',       label: 'Grade'  },
    { key: 'parentName',  label: 'Parent' },
    { key: 'parentPhone', label: 'Phone'  },
    {
      key: 'balanceUSD',
      label: 'USD Balance',
      render: (row) => (
        <span className={`tabular-nums font-medium ${row.balanceUSD > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
          {formatUSD(row.balanceUSD)}
        </span>
      ),
    },
    {
      key: 'balanceZiG',
      label: 'ZiG Balance',
      render: (row) => (
        <span className={`tabular-nums font-medium ${row.balanceZiG > 0 ? 'text-[#b91c1c]' : 'text-[#15803d]'}`}>
          {formatZiG(row.balanceZiG)}
        </span>
      ),
    },
    {
      key: 'overdueDays',
      label: 'Overdue',
      render: (row) =>
        row.overdueDays > 0 ? (
          <span className="font-medium text-[#b91c1c]">{row.overdueDays}d</span>
        ) : (
          <span className="text-[#78716c]">—</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {canManage && (
            <button
              onClick={() => setPaymentStudent(row)}
              className="min-h-[36px] rounded-md bg-[#065f46] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
            >
              Record Payment
            </button>
          )}
          <button
            onClick={() => router.push(`/accounting/students/${row.id}`)}
            className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
          >
            View →
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Table<StudentRow>
        columns={columns}
        data={students}
        emptyMessage="No students match the current filter."
        onRowClick={(row) => router.push(`/accounting/students/${row.id}`)}
      />

      {/* Payment entry modal */}
      {paymentStudent && (
        <PaymentModal
          open={true}
          student={paymentStudent}
          onSuccess={(data) => {
            setPaymentStudent(null);
            setReceipt(data);
            router.refresh();
          }}
          onClose={() => setPaymentStudent(null)}
        />
      )}

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal
          open={true}
          receipt={receipt}
          onClose={() => setReceipt(null)}
        />
      )}
    </>
  );
}
