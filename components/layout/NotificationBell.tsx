'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { icons } from './nav-config';

interface Item {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 120_000;

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/system/notifications?limit=10', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const { data } = await res.json();
      setItems(data.items);
      setUnread(data.unread);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // The count is refreshed now and then while the tab is visible; the list loads when opened.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, load]);

  async function markRead(body: { all: true } | { id: string }) {
    const res = await fetch('/api/system/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) void load();
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons.bell} /></svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[72px] z-40 overflow-hidden rounded-2xl bg-white shadow-[0_12px_32px_-8px_rgba(20,48,31,0.25)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => markRead({ all: true })} className="min-h-[44px] px-2 text-xs font-medium text-primary hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {failed && <li className="px-4 py-6 text-center text-sm text-muted">Could not load notifications.</li>}
            {!failed && items === null && <li className="px-4 py-6 text-center text-sm text-muted">Loading…</li>}
            {!failed && items?.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">You are all caught up.</li>}
            {items?.map((n) => {
              const inner = (
                <>
                  <p className={cn('text-sm text-ink', !n.readAt && 'font-semibold')}>{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-muted">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-subtle">{formatDateTime(n.createdAt)}</p>
                </>
              );
              return (
                <li key={n.id} className={cn('border-b border-line last:border-0', !n.readAt && 'bg-tint/60')}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => { setOpen(false); if (!n.readAt) void markRead({ id: n.id }); }} className="block px-4 py-3 hover:bg-rowhover">{inner}</Link>
                  ) : (
                    <button type="button" onClick={() => !n.readAt && markRead({ id: n.id })} className="block w-full px-4 py-3 text-left hover:bg-rowhover">{inner}</button>
                  )}
                </li>
              );
            })}
          </ul>
          <Link href="/system/notifications" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center justify-center border-t border-line text-xs font-medium text-primary hover:underline">View all notifications</Link>
        </div>
      )}
    </div>
  );
}
