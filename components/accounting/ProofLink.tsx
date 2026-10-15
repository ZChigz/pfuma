'use client';

import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

// Proofs of payment are private. This asks the server for a short-lived signed
// link each time it is clicked and opens it in a new tab.
export function ProofLink({ paymentId }: { paymentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/payments/${paymentId}/proof`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'Could not open the proof of payment');
        return;
      }
      window.open(data.data.url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary-hover disabled:opacity-50"
    >
      {busy ? 'Opening…' : 'View proof'}
    </button>
  );
}
