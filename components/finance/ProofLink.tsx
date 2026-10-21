'use client';

// Opens a payment's proof through a link that expires after a few minutes (the file itself is private).
import { useState } from 'react';
import { toast } from '@/components/ui/Toast';
import { api, problem } from '@/components/finance/shared';

export function ProofLink({ paymentId }: { paymentId: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const r = await api(`/api/finance/payments/${paymentId}/proof`, 'GET');
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    window.open((r.body.data as { url: string }).url, '_blank', 'noopener,noreferrer');
  }
  return <button type="button" className="text-sm text-primary underline" disabled={busy} onClick={() => void open()}>{busy ? 'Opening…' : 'Proof'}</button>;
}
