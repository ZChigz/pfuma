import Link from 'next/link';
import type { ReactNode } from 'react';

// Colours for the two series (reference palette slots 1 and 2, validated as an adjacent pair)
// and a neutral for "not recorded". Set once here so every chart agrees.
export const BOYS = '#2a78d6';
export const GIRLS = '#eb6834';
export const NEUTRAL = '#a8b0aa';
export const CAPACITY_INK = '#14301f';

export function ChartPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl bg-white p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** What a chart, card or list shows instead of nothing: why it is empty and where to fix it. */
export function EmptyPanel({ message, action }: { message: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl bg-canvas px-4 py-6 sm:items-center sm:text-center">
      <p className="text-sm text-muted">{message}</p>
      {action && (
        <Link href={action.href} className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden="true" className={line ? 'h-4 w-[2px]' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: color }} />
      {label}
    </li>
  );
}

export function ChartSkeleton() {
  return <div aria-hidden="true" className="h-64 animate-pulse rounded-2xl bg-white" />;
}
