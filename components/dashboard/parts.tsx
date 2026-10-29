import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

const BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(BTN, 'bg-primary text-white hover:bg-primary-hover')}>
      {children}
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(BTN, 'border border-primary bg-white text-primary hover:bg-tint')}>
      {children}
    </Link>
  );
}

export function SmallLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[36px] items-center rounded-full border border-primary px-4 text-xs font-semibold text-primary transition-colors hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </Link>
  );
}

export function DashboardHeader({ subtitle, actions }: { subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('rounded-2xl bg-white p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Half-ring gauge with a two-item legend. */
export function Gauge({
  percent,
  caption,
  filledLabel,
  emptyLabel,
}: {
  percent: number;
  caption: string;
  filledLabel: string;
  emptyLabel: string;
}) {
  const arc = Math.PI * 70;
  const filled = (percent / 100) * arc;
  return (
    <>
      <svg viewBox="0 0 180 100" className="mx-auto w-full max-w-[240px]" role="img" aria-label={`${percent}% ${caption}`}>
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="#e3e9e4" strokeWidth="26" />
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="#14613f" strokeWidth="26" strokeDasharray={`${filled} ${arc}`} />
        <text x="90" y="84" textAnchor="middle" className="fill-ink" style={{ fontSize: 30, fontWeight: 700 }}>
          {percent}%
        </text>
      </svg>
      <p className="mt-2 text-center text-xs text-muted">{caption}</p>
      <ul className="mt-4 flex justify-center gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />{filledLabel}</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-line" aria-hidden="true" />{emptyLabel}</li>
      </ul>
    </>
  );
}

export interface Bar {
  id: string;
  name: string;
  count: number;
}

/** Pill bars: the tallest is dark green, the rest hatched. */
export function PillBars({ bars, unit }: { bars: Bar[]; unit: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  const top = bars.reduce<Bar | null>((best, b) => (b.count > 0 && (!best || b.count > best.count) ? b : best), null);
  return (
    <div className="flex h-[190px] items-end justify-between gap-2 sm:gap-3" role="list">
      {bars.map((b) => {
        const isTop = b.id === top?.id;
        const h = b.count === 0 ? 8 : Math.max(18, (b.count / max) * 100);
        return (
          <div key={b.id} role="listitem" className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${b.name}: ${b.count} ${unit}`}>
            <span className={cn('text-xs font-semibold tabular-nums', isTop ? 'text-ink' : 'text-muted')}>{b.count}</span>
            <div className={cn('w-full max-w-[52px] rounded-full', isTop ? 'bg-[#0b3a25]' : b.count === 0 ? 'bg-line' : 'hatch')} style={{ height: `${h}%` }} />
            <span className="w-full truncate text-center text-xs text-muted">{b.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface TodoItem {
  text: string;
  href: string;
  tone: string;
  /** A short second line under the text. */
  hint?: string;
}

export function TodoList({ items, emptyText }: { items: TodoItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="py-6 text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((n) => (
        <li key={n.text}>
          <Link href={n.href} className="flex items-start gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className={cn('mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full', n.tone)} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm leading-snug text-ink">{n.text}</span>
              {n.hint && <span className="block text-xs text-muted">{n.hint}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PersonRow({ name, detail, badge }: { name: string; detail: string; badge: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tint text-sm font-semibold text-primary" aria-hidden="true">
        {name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      {badge}
    </li>
  );
}

/** Layout wrappers so every role's dashboard shares the same grid. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function ChartRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">{children}</div>;
}
