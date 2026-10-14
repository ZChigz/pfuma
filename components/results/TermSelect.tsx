'use client';

import { useRouter } from 'next/navigation';
import { TERMS } from '@/lib/results';

interface Props {
  classId: string;
  term:    string;
}

export function TermSelect({ classId, term }: Props) {
  const router = useRouter();

  return (
    <select
      defaultValue={term}
      onChange={(e) => router.push(`/head/results?classId=${classId}&term=${encodeURIComponent(e.target.value)}`)}
      className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
