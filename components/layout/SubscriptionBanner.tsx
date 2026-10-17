import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Banner } from '@/lib/system/subscription';

/** Shown on every page: 14 days before the renewal date, when overdue, and when suspended. */
export function SubscriptionBanner({ banner, canView }: { banner: Banner | null; canView: boolean }) {
  if (!banner) return null;
  const serious = banner.kind !== 'renewal';
  return (
    <div
      role={serious ? 'alert' : 'status'}
      className={cn('mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-2.5 text-sm', serious ? 'bg-danger-bg text-danger' : 'bg-warn-bg text-warn')}
    >
      <span>{banner.text}</span>
      {canView && <Link href="/system/subscription" className="min-h-[44px] content-center font-semibold underline">View subscription</Link>}
    </div>
  );
}
