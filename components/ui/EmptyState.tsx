import Link from 'next/link';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Link-style call to action. For a button that opens a drawer, pass `action`. */
  cta?: { label: string; href: string };
  action?: ReactNode;
}

export function EmptyState({ title, description, cta, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-tint text-primary" aria-hidden="true">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4m16 0h-4l-2 3h-4l-2-3H4" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {cta.label}
        </Link>
      )}
      {action}
    </div>
  );
}
