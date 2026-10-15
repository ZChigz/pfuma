import Link from 'next/link';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  /** Lines under the figure. */
  children?: ReactNode;
  href?: string;
}

/** The shape every dashboard summary card shares. */
export function SummaryCard({ label, value, children, href }: Props) {
  const body = (
    <>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="mt-4 text-4xl font-semibold leading-none tabular-nums tracking-tight text-ink">{value}</p>
      <div className="mt-3 space-y-0.5 text-xs text-muted">{children}</div>
    </>
  );
  const cls = 'block min-h-[140px] rounded-2xl bg-white p-5';
  return href ? <Link href={href} className={`${cls} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function SummaryCardSkeleton() {
  return <div aria-hidden="true" className="min-h-[140px] animate-pulse rounded-2xl bg-white" />;
}

/** A card with nothing to count: a dash instead of a zero, and a link to the step that fills it. */
export function SummaryCardEmpty({ label, message, action }: { label: string; message: string; action?: { label: string; href: string } }) {
  return (
    <SummaryCard label={label} value={<span aria-label="no data">—</span>}>
      <p>{message}</p>
      {action && (
        <Link href={action.href} className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline">
          {action.label}
        </Link>
      )}
    </SummaryCard>
  );
}
