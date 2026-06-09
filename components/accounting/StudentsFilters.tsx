'use client';

import { useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { label: 'All',         value: ''          },
  { label: 'Owing',       value: 'owing'     },
  { label: 'Overdue 30+', value: 'overdue30' },
  { label: 'Cleared',     value: 'cleared'   },
] as const;

interface StudentsFiltersProps {
  currentStatus?: string;
  currentQ?: string;
}

export function StudentsFilters({ currentStatus, currentQ }: StudentsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Status tabs */}
      <div className="flex gap-1 rounded-lg border border-[#e7e5e4] bg-white p-1">
        {TABS.map((tab) => {
          const active = (currentStatus ?? '') === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => updateParam('status', tab.value)}
              className={`min-h-[36px] rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                active
                  ? 'bg-[#065f46] text-white'
                  : 'text-[#78716c] hover:bg-stone-100 hover:text-[#292524]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78716c]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          placeholder="Search by name…"
          defaultValue={currentQ}
          onChange={(e) => {
            clearTimeout(searchTimer.current);
            const val = e.target.value;
            searchTimer.current = setTimeout(() => updateParam('q', val), 350);
          }}
          className="min-h-[44px] w-full rounded-md border border-[#e7e5e4] bg-white pl-9 pr-3 text-sm text-[#292524] placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30 sm:w-64"
        />
      </div>
    </div>
  );
}
