import Link from 'next/link';
import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadFeed, timeAgo } from '@/lib/system/activity';
import { loadUpcomingEvents } from '@/lib/system/upcoming';
import { formatDate } from '@/lib/utils';
import { ChartPanel, EmptyPanel } from '@/components/system/charts/chart-parts';

export async function UpcomingEvents({ user }: { user: AccessUser }) {
  if (!can(user, 'system.calendar.view')) return null;
  const events = await loadUpcomingEvents(getScopedDb(user.schoolId, user.id), user);
  return (
    <ChartPanel title="Upcoming events" subtitle="The next five on the calendar">
      {events.length === 0 ? (
        <EmptyPanel
          message="Nothing is coming up. Add this term's key dates."
          action={can(user, 'system.calendar.create') ? { label: 'Add an event', href: '/system/calendar?new=1' } : { label: 'Open the calendar', href: '/system/calendar' }}
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.key} className="py-2.5 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="text-xs text-muted">{formatDate(e.startDate)}{e.endDate !== e.startDate ? ` to ${formatDate(e.endDate)}` : ''}{e.allDay ? '' : ` · ${e.startTime}`}</p>
              </li>
            ))}
          </ul>
          <Link href="/system/calendar" className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">Open the calendar</Link>
        </>
      )}
    </ChartPanel>
  );
}

export async function RecentActivity({ user }: { user: AccessUser }) {
  if (!can(user, 'system.audit.view')) return null;
  const feed = await loadFeed(getScopedDb(user.schoolId, user.id), user.schoolId);
  const now = new Date();
  return (
    <ChartPanel title="Recent activity" subtitle="The last ten things done in the system">
      {feed.length === 0 ? (
        <EmptyPanel message="Nothing has been done yet. Changes appear here as people use Pfuma." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {feed.map((f) => (
              <li key={f.id} className="py-2.5 first:pt-0 last:pb-0">
                <p className="break-words text-sm text-ink">{f.text}</p>
                <p className="text-xs text-muted">
                  <time dateTime={f.when.toISOString()} title={f.when.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'}>{timeAgo(f.when, now)}</time>
                </p>
              </li>
            ))}
          </ul>
          <Link href="/system/audit-log" className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-primary hover:underline">Open the audit log</Link>
        </>
      )}
    </ChartPanel>
  );
}
