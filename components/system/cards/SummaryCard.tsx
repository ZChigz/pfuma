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

export function SummaryCardEmpty({ label, message }: { label: string; message: string }) {
  return (
    <SummaryCard label={label} value="—">
      <p>{message}</p>
    </SummaryCard>
  );
}
