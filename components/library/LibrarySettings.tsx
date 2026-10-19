'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  libraryFineLimit: number;
  studentLoanLimit: number;
  staffLoanLimit: number;
}

// Checkout is blocked for a member with an overdue book, or with unpaid fines above the limit.
export function LibrarySettings(initial: Props) {
  const router = useRouter();
  const toast = useToast();
  const [fine, setFine] = useState(String(initial.libraryFineLimit));
  const [students, setStudents] = useState(String(initial.studentLoanLimit));
  const [staff, setStaff] = useState(String(initial.staffLoanLimit));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/library/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryFineLimit: Number(fine), studentLoanLimit: Number(students), staffLoanLimit: Number(staff) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not save'); return; }
      toast.success('Library settings saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const input = 'min-h-[44px] w-28 rounded-xl border border-line bg-canvas px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <h2 className="text-base font-semibold text-ink">Borrowing rules</h2>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Books a student may borrow
          <input type="number" min={0} className={input} value={students} onChange={(e) => setStudents(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Books a staff member may borrow
          <input type="number" min={0} className={input} value={staff} onChange={(e) => setStaff(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Unpaid fines allowed ($)
          <input type="number" min={0} step="0.01" className={input} value={fine} onChange={(e) => setFine(e.target.value)} /></label>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
