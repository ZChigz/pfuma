'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  passGrade: string;
  oLevelRanking: 'AVERAGE' | 'PASSES_THEN_AVERAGE';
}

// Pass grade and how O Level classes are ranked.
export function ResultsSettings({ passGrade, oLevelRanking }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [grade, setGrade] = useState(passGrade);
  const [mode, setMode] = useState(oLevelRanking);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/results/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passGrade: grade.trim(), oLevelRanking: mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not save'); return; }
      toast.success('Results settings saved');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Pass grade and ranking</h2>
        <p className="mt-1 text-sm text-muted">Applies the next time a class is published.</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Pass grade (this or better)
          <input
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            maxLength={5}
            className="min-h-[44px] w-24 rounded-xl border border-line bg-canvas px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          O Level ranking
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Props['oLevelRanking'])}
            className="min-h-[44px] rounded-xl border border-line bg-canvas px-3 text-sm font-normal focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="AVERAGE">By average percentage</option>
            <option value="PASSES_THEN_AVERAGE">By number of passes, then average</option>
          </select>
        </label>
        <Button onClick={save} loading={busy} disabled={grade.trim() === passGrade && mode === oLevelRanking}>Save</Button>
      </div>
    </div>
  );
}
