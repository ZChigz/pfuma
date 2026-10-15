'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSidebarStore } from '@/lib/sidebar-store';
import { cn } from '@/lib/utils';
import { icons } from './nav-config';
import { NotificationBell } from './NotificationBell';
import { TermSwitcher, type TermOption } from './TermSwitcher';
import { UserMenu } from './UserMenu';

export interface JumpItem {
  label: string;
  href: string;
  icon: string;
}

interface TopBarProps {
  schoolName: string;
  logoUrl: string | null;
  terms: TermOption[];
  viewTermId: string | null;
  unread: number;
  fullName: string;
  roleLabel: string;
  jumpItems: JumpItem[];
  // Every flag below comes from can() on the server.
  canSwitchTerm: boolean;
  canSeeNotifications: boolean;
  canViewProfile: boolean;
  canChangePassword: boolean;
}

function SchoolMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      <Image
        src={logoUrl}
        alt=""
        width={40}
        height={40}
        unoptimized
        onError={() => setBroken(true)}
        className="h-10 w-10 flex-shrink-0 rounded-full bg-white object-contain"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-primary" aria-hidden="true">
      {name.trim()[0]?.toUpperCase() ?? 'P'}
    </div>
  );
}

export function TopBar(props: TopBarProps) {
  const { schoolName, logoUrl, terms, viewTermId, unread, fullName, roleLabel, jumpItems } = props;
  const router = useRouter();
  const { toggle } = useSidebarStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? jumpItems.filter((i) => i.label.toLowerCase().includes(q)) : jumpItems;
  }, [jumpItems, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) go(results[cursor].href);
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4">
      <button
        type="button"
        onClick={toggle}
        aria-label="Open navigation menu"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* School logo and name */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
        <SchoolMark name={schoolName} logoUrl={logoUrl} />
        <p className="min-w-0 truncate text-sm font-semibold text-ink md:max-w-[220px]">{schoolName || 'Pfuma'}</p>
      </div>

      {/* Jump-to-page search (desktop) */}
      <div className="relative hidden max-w-sm flex-1 md:block">
        <svg className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onInputKey}
          placeholder="Jump to a page"
          aria-label="Jump to a page"
          role="combobox"
          aria-expanded={open}
          aria-controls="jump-list"
          className="h-11 w-full rounded-full bg-white pl-10 pr-16 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-xl bg-tint px-1.5 py-0.5 text-[11px] font-medium text-muted lg:block">Ctrl K</kbd>
        {open && (
          <ul id="jump-list" role="listbox" className="absolute left-0 right-0 top-12 z-30 max-h-80 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(20,48,31,0.25)]">
            {results.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">No page matches &ldquo;{query}&rdquo;.</li>}
            {results.map((r, i) => (
              <li key={r.href} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); go(r.href); }}
                  className={cn('flex min-h-[40px] w-full items-center gap-3 rounded-2xl px-3 text-left text-sm text-ink', i === cursor && 'bg-tint')}
                >
                  <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[r.icon]} /></svg>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {props.canSwitchTerm && (
        <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
          <TermSwitcher terms={terms} selectedId={viewTermId} />
        </div>
      )}

      <div className={cn('flex items-center gap-2 md:gap-3', props.canSwitchTerm ? 'ml-auto sm:ml-0' : 'ml-auto')}>
        {props.canSeeNotifications && <NotificationBell initialUnread={unread} />}
        <UserMenu fullName={fullName} roleLabel={roleLabel} canViewProfile={props.canViewProfile} canChangePassword={props.canChangePassword} />
      </div>

    </header>
  );
}
