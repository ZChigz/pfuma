// Finance helpers that server pages use directly: class names, the payment-method list and labels, money display and the pager.
// This file is NOT a client module. A server component that imports a constant or calls a function from a 'use client' file gets a
// client reference instead of the value, and the production render fails ("Something went wrong"); so these live here, and
// components/finance/shared.tsx re-exports them for the client components.
import { formatMoney, formatTotals, type Cur, type Totals } from '@/lib/finance/money';
import { CLERK_METHODS, METHOD_LABEL, type Method } from '@/lib/finance/methods';

export const fieldClass = 'h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-canvas disabled:text-muted';
export const labelClass = 'text-sm font-medium text-ink';
export const linkButton = 'inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint';
export const primaryLink = 'inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover';

export const CUR_LABEL: Record<Cur, string> = { USD: 'US dollars', ZIG: 'ZiG' };

export const METHOD_OPTIONS = CLERK_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }));
export const methodLabel = (m: string) => METHOD_LABEL[m as Method] ?? m;

export function Money({ cents, currency, className }: { cents: number; currency: Cur; className?: string }) {
  return <span className={`tabular-nums ${className ?? ''}`}>{formatMoney(cents, currency)}</span>;
}

/** US dollars and ZiG side by side, never added. */
export function MoneyLine({ totals, empty = '—' }: { totals: Partial<Totals>; empty?: string }) {
  const parts = (['USD', 'ZIG'] as const).filter((c) => (totals[c] ?? 0) !== 0);
  if (parts.length === 0) return <span className="text-muted">{empty}</span>;
  return <span className="tabular-nums">{formatTotals(totals)}</span>;
}

/** A small pager for the lists. A server component: hrefFor is a function, which cannot be passed to a client component. */
export function Pager({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const cls = 'inline-flex min-h-[40px] items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-tint';
  return (
    <nav className="flex items-center justify-between gap-3 pt-3" aria-label="Pages">
      {page > 1 ? <a className={cls} href={hrefFor(page - 1)}>Previous</a> : <span />}
      <span className="text-sm text-muted">Page {page} of {pages} · {total} in all</span>
      {page < pages ? <a className={cls} href={hrefFor(page + 1)}>Next</a> : <span />}
    </nav>
  );
}
