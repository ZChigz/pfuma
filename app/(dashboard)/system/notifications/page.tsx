import Link from 'next/link';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { formatDateTime, cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarkAllReadButton } from '@/components/system/MarkAllReadButton';

export const metadata = { title: 'Notifications · Pfuma' };
const PAGE_SIZE = 25;

// Every signed-in person sees their own notifications here (account.notifications.view is self-service).
export default async function NotificationsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user } = await getAccess();
  const db = getScopedDb(user.schoolId, user.id);
  const raw = Number(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const page = Number.isInteger(raw) && raw > 0 ? raw : 1;

  const [total, unread, items] = await Promise.all([
    db.notification.count({ where: { userId: user.id } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : 'You are all caught up.'}
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Notifications' }]}
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />
      {items.length === 0 ? (
        <EmptyState title="No notifications yet" description="Things like role changes and term dates will appear here." />
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-white">
          {items.map((n) => {
            const inner = (
              <>
                <p className={cn('text-sm text-ink', !n.readAt && 'font-semibold')}>{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-subtle">{formatDateTime(n.createdAt)}</p>
              </>
            );
            return (
              <li key={n.id} className={cn('border-b border-line last:border-0', !n.readAt && 'bg-tint/60')}>
                {n.link ? <Link href={n.link} className="block px-4 py-3 hover:bg-rowhover">{inner}</Link> : <div className="px-4 py-3">{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          {page > 1 ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={`/system/notifications?page=${page - 1}`}>← Newer</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={`/system/notifications?page=${page + 1}`}>Older →</Link> : <span />}
        </div>
      )}
    </div>
  );
}
