'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await fetch('/api/system/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className="min-h-[44px] rounded-xl bg-primary px-4 text-sm font-medium text-white disabled:opacity-60">
      {busy ? 'Marking…' : 'Mark all as read'}
    </button>
  );
}
