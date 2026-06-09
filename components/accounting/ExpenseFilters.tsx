'use client';

import { useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { EXPENSE_CATEGORIES } from './ExpenseForm';

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
];

interface Props {
  currentCurrency?: string;
  currentCategory?: string;
  currentFrom?: string;
  currentTo?: string;
}

export function ExpenseFilters({
  currentCurrency,
  currentCategory,
  currentFrom,
  currentTo,
}: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const debounceRef  = useRef<ReturnType<typeof setTimeout>>();

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {/* Currency toggle */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Currency</span>
        <div className="flex gap-1 rounded-lg border border-[#e7e5e4] bg-white p-0.5">
          {[
            { value: '',    label: 'All' },
            { value: 'USD', label: 'USD' },
            { value: 'ZIG', label: 'ZiG' },
          ].map((opt) => {
            const active = (currentCurrency ?? '') === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => update('currency', opt.value)}
                className={`min-h-[36px] rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                  active
                    ? 'bg-[#065f46] text-white'
                    : 'text-[#78716c] hover:bg-stone-100 hover:text-[#292524]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Category select */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Category</span>
        <select
          value={currentCategory ?? ''}
          onChange={(e) => update('category', e.target.value)}
          className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Date from */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[#78716c]">From</span>
        <input
          type="date"
          defaultValue={currentFrom}
          onChange={(e) => {
            clearTimeout(debounceRef.current);
            const val = e.target.value;
            debounceRef.current = setTimeout(() => update('from', val), 300);
          }}
          className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[#78716c]">To</span>
        <input
          type="date"
          defaultValue={currentTo}
          onChange={(e) => {
            clearTimeout(debounceRef.current);
            const val = e.target.value;
            debounceRef.current = setTimeout(() => update('to', val), 300);
          }}
          className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
        />
      </div>
    </div>
  );
}
