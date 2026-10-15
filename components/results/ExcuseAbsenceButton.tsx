'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// Head only. An excused absence is left out of the student's subjects instead of counting as 0.
export function ExcuseAbsenceButton({ markId, excused }: { markId: string; excused: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    const reason = window.prompt(excused ? 'Why remove the excuse? (recorded in the audit log)' : 'Why is this absence excused? (recorded in the audit log)');
    if (!reason) return;
    setBusy(true);
    try {
      const res = await fetch('/api/results/marks/excuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markId, excused: !excused, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not change the excuse'); return; }
      toast.success(excused ? 'Excuse removed — counts as 0 again' : 'Absence excused — left out of the average');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <Button variant="secondary" size="sm" onClick={run} loading={busy}>{excused ? 'Remove excuse' : 'Excuse'}</Button>;
}
