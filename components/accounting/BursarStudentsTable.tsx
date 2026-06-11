'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Table, type Column } from '@/components/ui/Table';
import { formatUSD, formatZiG } from '@/lib/utils';
import { PaymentModal, type ReceiptData } from './PaymentModal';
import { ReceiptModal } from './ReceiptModal';

export interface BursarStudentRow {
  id: string;
  fullName: string;
  grade: string;
  className: string;
  parentPhone: string;
  balanceUSD: number;
  balanceZiG: number;
}

interface Props {
  students: BursarStudentRow[];
}

export function BursarStudentsTable({ students }: Props) {
  const router = useRouter();
  const [paymentStudent, setPaymentStudent] = useState<BursarStudentRow | null>(null);
  const [receipt, setReceipt]               = useState<ReceiptData | null>(null);

  const columns: Column<BursarStudentRow>[] = [
    { key: 'fullName',  label: 'Name'  },
    { key: 'className', label: 'Class' },
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
      key: 'actions',
      label: '',
      render: (row) => (
        <button
          onClick={() => setPaymentStudent(row)}
          className="min-h-[36px] rounded-md bg-[#065f46] px-2.5 text-xs font-medium text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
        >
          Record Payment
        </button>
      ),
    },
  ];

  return (
    <>
      <Table<BursarStudentRow>
        columns={columns}
        data={students}
        emptyMessage="No students found."
      />

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
