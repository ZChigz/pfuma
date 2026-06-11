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
      className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
    >
      {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
