'use client';

import { useRouter } from 'next/navigation';

const GRADES = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
];

const TERMS = ['Term 1, 2026', 'Term 2, 2026', 'Term 3, 2026'];

interface Props {
  currentGrade: string;
  currentTerm:  string;
}

export function ResultsFilters({ currentGrade, currentTerm }: Props) {
  const router = useRouter();

  function navigate(grade: string, term: string) {
    if (!grade || !term) return;
    router.push(`/results/reports?grade=${encodeURIComponent(grade)}&term=${encodeURIComponent(term)}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium   text-[#6b7a70]">Grade</span>
        <select
          defaultValue={currentGrade}
          onChange={(e) => navigate(e.target.value, currentTerm)}
          className="min-h-[44px] rounded-xl border border-[#e3e9e4] bg-white px-3 text-sm text-[#14301f] focus:outline-none focus:ring-2 focus:ring-[#14613f]/30"
        >
          <option value="">— Select grade —</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium   text-[#6b7a70]">Term</span>
        <select
          defaultValue={currentTerm}
          onChange={(e) => navigate(currentGrade, e.target.value)}
          className="min-h-[44px] rounded-xl border border-[#e3e9e4] bg-white px-3 text-sm text-[#14301f] focus:outline-none focus:ring-2 focus:ring-[#14613f]/30"
        >
          <option value="">— Select term —</option>
          {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  );
}
