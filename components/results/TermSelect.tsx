'use client';

import { useRouter } from 'next/navigation';

interface Props {
  classId: string;
  termId:  string;
  terms:   { id: string; name: string }[];
}

export function TermSelect({ classId, termId, terms }: Props) {
  const router = useRouter();

  return (
    <select
      defaultValue={termId}
      onChange={(e) => router.push(`/head/results?classId=${classId}&termId=${e.target.value}`)}
      className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
    >
      {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}
