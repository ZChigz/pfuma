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
        <span className="text-xs font-medium   text-muted">Currency</span>
        <div className="flex gap-1 rounded-xl border border-line bg-white p-0.5">
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
                className={`min-h-[36px] rounded-xl px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                  active
                    ? 'bg-primary text-white'
                    : 'text-muted hover:bg-tint hover:text-ink'
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
        <span className="text-xs font-medium   text-muted">Category</span>
        <select
          value={currentCategory ?? ''}
          onChange={(e) => update('category', e.target.value)}
          className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
        <span className="text-xs font-medium   text-muted">From</span>
        <input
          type="date"
          defaultValue={currentFrom}
          onChange={(e) => {
            clearTimeout(debounceRef.current);
            const val = e.target.value;
            debounceRef.current = setTimeout(() => update('from', val), 300);
          }}
          className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Date to */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium   text-muted">To</span>
        <input
          type="date"
          defaultValue={currentTo}
          onChange={(e) => {
            clearTimeout(debounceRef.current);
            const val = e.target.value;
            debounceRef.current = setTimeout(() => update('to', val), 300);
          }}
          className="min-h-[44px] rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
    </div>
  );
}
