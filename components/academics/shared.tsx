'use client';

// Small pieces the Academics screens share: calling the API (re-exported from Student Information), tabs, the closed-term notice,
// a subject colour dot and the yes/no pills.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
export { api, problem, fieldMessages, type ApiResult } from '@/components/students/shared';

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; badge?: number | string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'inline-flex min-h-[40px] flex-shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
            value === t.id ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink',
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge !== 0 && (
            <span className={cn('rounded-full px-2 text-xs', value === t.id ? 'bg-white/20' : 'bg-canvas')}>{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Shown on every page of a closed term: it can be looked at, not changed. */
export function ClosedNotice({ termName }: { termName: string }) {
  return (
    <div role="status" className="rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
      {termName} is closed. You can look at everything, but nothing can be changed.
    </div>
  );
}

export function Dot({ colour, className }: { colour: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full', className)} style={{ backgroundColor: colour }} />;
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'danger' | 'info' | 'success'; children: ReactNode }) {
  const t = {
    warn: 'border-warn-line bg-warn-bg text-warn', danger: 'border-danger-line bg-danger-bg text-danger',
    info: 'border-line bg-tint text-ink', success: 'border-line bg-success-bg text-success',
  }[tone];
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-xl border px-4 py-3 text-sm', t)}>{children}</div>;
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export const linkButton = 'inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint';
export const primaryLink = 'inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover';

export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th scope="col" className={cn('px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted', className)}>{children}</th>;
}
export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cn('px-3 py-2 text-sm text-ink', className)}>{children}</td>;
}
