'use client';

import { useRouter } from 'next/navigation';

interface Props {
  current: string;
}

export function CurrencyToggle({ current }: Props) {
  const router = useRouter();

  return (
    <div className="flex gap-1 rounded-lg border border-[#e3e9e4] bg-white p-0.5">
      {(['USD', 'ZIG'] as const).map((c) => {
        const active = current === c;
        return (
          <button
            key={c}
            onClick={() => router.push(`/accounting?currency=${c}`)}
            aria-pressed={active}
            className={`min-h-[36px] rounded-xl px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#14613f]/40 ${
              active
                ? 'bg-[#14613f] text-white'
                : 'text-[#6b7a70] hover:bg-stone-100 hover:text-[#14301f]'
            }`}
          >
            {c === 'ZIG' ? 'ZiG' : 'USD'}
          </button>
        );
      })}
    </div>
  );
}
