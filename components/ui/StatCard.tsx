import Link from 'next/link';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  note?: string;
  href?: string;
  /** Dark-green gradient surface. Use for the single most important figure. */
  hero?: boolean;
  /** Colours the value for warnings. */
  tone?: 'default' | 'warning' | 'danger';
  className?: string;
}

const toneClass = {
  default: '',
  warning: 'text-[#b45309]',
  danger: 'text-[#b91c1c]',
} as const;

export function StatCard({ label, value, note, href, hero, tone = 'default', className }: StatCardProps) {
  const body = (
    <>
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">{label}</p>
        {href && (
          <span
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border transition-colors',
              hero
                ? 'border-white/60 bg-white text-[#14613f]'
                : 'border-[#14301f]/70 text-[#14301f] group-hover:border-[#14613f] group-hover:bg-[#14613f] group-hover:text-white',
            )}
            aria-hidden="true"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M8 7h9v9" />
            </svg>
          </span>
        )}
      </div>
      <div className="relative mt-6">
        <p className={cn('text-4xl font-semibold leading-none tabular-nums tracking-tight', !hero && toneClass[tone])}>{value}</p>
        {note && <p className={cn('mt-3 text-xs', hero ? 'text-emerald-100/90' : 'text-[#6b7a70]')}>{note}</p>}
      </div>
    </>
  );

  const classes = cn(
    'group flex min-h-[140px] flex-col justify-between rounded-2xl p-5',
    hero ? 'term-card text-white' : 'bg-white text-[#14301f]',
    className,
  );

  return href ? (
    <Link href={href} className={cn(classes, 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14613f]/50 focus-visible:ring-offset-2')}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
