'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export function SettleFineButton({ borrowingId, onDone }: { borrowingId: string; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/library/borrowing/${borrowingId}/settle-fine`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not settle the fine'); return; }
      toast.success('Fine settled');
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return <Button size="sm" variant="secondary" loading={busy} onClick={(e) => { e.stopPropagation(); run(); }}>Settle fine</Button>;
}
