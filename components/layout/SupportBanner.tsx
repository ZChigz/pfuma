'use client';

import { useState } from 'react';

/** Shown on every page of a Pfuma support session: it is read-only, and this is how to leave. */
export function SupportBanner({ schoolName }: { schoolName: string }) {
  const [busy, setBusy] = useState(false);
  async function leave() {
    setBusy(true);
    try {
      const res = await fetch('/api/system/support/end', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      window.location.assign(res.ok ? body.data?.redirect ?? '/platform' : '/platform');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-tint px-4 py-2.5 text-sm text-ink">
      <span>Pfuma support is looking at <strong>{schoolName}</strong>, read-only. Nothing can be changed.</span>
      <button type="button" onClick={leave} disabled={busy} className="min-h-[44px] font-semibold underline disabled:opacity-60">{busy ? 'Leaving…' : 'Leave'}</button>
    </div>
  );
}
