'use client';

import { useRouter } from 'next/navigation';

interface Props {
  current: string;
}

export function CurrencyToggle({ current }: Props) {
  const router = useRouter();

  return (
    <div className="flex gap-1 rounded-xl border border-line bg-white p-0.5">
      {(['USD', 'ZIG'] as const).map((c) => {
        const active = current === c;
        return (
          <button
            key={c}
            onClick={() => router.push(`/accounting?currency=${c}`)}
            aria-pressed={active}
            className={`min-h-[36px] rounded-xl px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              active
                ? 'bg-primary text-white'
                : 'text-muted hover:bg-tint hover:text-ink'
            }`}
          >
            {c === 'ZIG' ? 'ZiG' : 'USD'}
          </button>
        );
      })}
    </div>
  );
}
