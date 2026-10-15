'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// Director only: reopens a closed term so its marks and results can be corrected.
export function ReopenTermButton({ termId, termName }: { termId: string; termName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    const reason = window.prompt(`Why reopen ${termName}? (at least 10 characters, recorded in the audit log)`);
    if (!reason) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/director/terms/${termId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not reopen the term'); return; }
      toast.success(`${termName} reopened`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <Button variant="secondary" size="sm" onClick={run} loading={busy}>Reopen {termName}</Button>;
}
