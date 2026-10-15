'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { termLabel } from '@/lib/term-label';
import { toast } from '@/components/ui/Toast';

export interface TermOption {
  id: string;
  name: string;
  status: string;
}

// Changes the term the dashboard and reports SHOW. It never opens or closes a term.
export function TermSwitcher({ terms, selectedId }: { terms: TermOption[]; selectedId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (terms.length === 0) return <span className="text-xs text-muted">No term yet</span>;

  async function change(termId: string) {
    setBusy(true);
    try {
      const res = await fetch('/api/system/view-term', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termId }),
      });
      if (!res.ok) {
        toast.error('Could not switch term');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex w-full items-center gap-2 sm:w-auto">
      <span className="sr-only">Term shown on the dashboard and reports</span>
      <select
        value={selectedId ?? ''}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="min-h-[44px] w-full rounded-full bg-white px-4 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 sm:w-auto"
      >
        {terms.map((t) => (
          <option key={t.id} value={t.id}>
            {termLabel(t.name)}{t.status === 'OPEN' ? ' (open)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
