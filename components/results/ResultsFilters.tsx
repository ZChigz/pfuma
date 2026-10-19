'use client';

import { useRouter } from 'next/navigation';

interface Option { id: string; name: string }

interface Props {
  levels:         Option[];
  terms:          Option[];
  currentLevelId: string;
  currentTermId:  string;
}

export function ResultsFilters({ levels, terms, currentLevelId, currentTermId }: Props) {
  const router = useRouter();

  function navigate(levelId: string, termId: string) {
    if (!levelId || !termId) return;
    router.push(`/results/reports?levelId=${levelId}&termId=${termId}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium   text-muted">Level</span>
        <select
          defaultValue={currentLevelId}
          onChange={(e) => navigate(e.target.value, currentTermId)}
          className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">— Select level —</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium   text-muted">Term</span>
        <select
          defaultValue={currentTermId}
          onChange={(e) => navigate(currentLevelId, e.target.value)}
          className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">— Select term —</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </div>
  );
}
