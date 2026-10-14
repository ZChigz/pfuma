'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useSidebarStore } from '@/lib/sidebar-store';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, flatNav, icons } from './nav-config';
import type { UserRole } from '@/types';

interface TopBarProps {
  schoolName: string;
  currentTerm?: string;
  role?: UserRole;
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

export function TopBar({ schoolName, currentTerm, role }: TopBarProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { toggle } = useSidebarStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => flatNav(role), [role]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
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
    <header className="flex items-center gap-3 pb-4">
      <button
        onClick={toggle}
        aria-label="Open navigation menu"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-[#5b6a61] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14613f]/40 md:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Jump-to-page search */}
      <div className="relative max-w-md flex-1">
        <svg className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5b6a61]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
          className="h-11 w-full rounded-full bg-white pl-10 pr-16 text-sm text-[#14301f] placeholder:text-[#8a968e] focus:outline-none focus:ring-2 focus:ring-[#14613f]/40"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-xl bg-[#eef1ee] px-1.5 py-0.5 text-[11px] font-medium text-[#6b7a70] sm:block">
          Ctrl K
        </kbd>
        {open && (
          <ul id="jump-list" role="listbox" className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(20,48,31,0.25)]">
            {results.length === 0 && <li className="px-3 py-2.5 text-sm text-[#6b7a70]">No page matches &ldquo;{query}&rdquo;.</li>}
            {results.map((r, i) => (
              <li key={r.href} role="option" aria-selected={i === cursor}>
                <button
                  onMouseDown={(e) => { e.preventDefault(); go(r.href); }}
                  className={cn('flex min-h-[40px] w-full items-center gap-3 rounded-2xl px-3 text-left text-sm text-[#14301f]', i === cursor && 'bg-[#eef4ef]')}
                >
                  <svg className="h-4 w-4 text-[#14613f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[r.icon]} /></svg>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {currentTerm && (
          <span className="hidden rounded-full bg-white px-3.5 py-2 text-xs font-medium text-[#5b6a61] lg:inline-block">
            {currentTerm}
          </span>
        )}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#14613f] text-sm font-semibold text-white" aria-hidden="true">
            {initials(session?.user?.fullName)}
          </div>
          <div className="hidden min-w-0 leading-tight sm:block">
            <p className="max-w-[160px] truncate text-sm font-semibold text-[#14301f]">{session?.user?.fullName ?? ''}</p>
            <p className="max-w-[160px] truncate text-xs text-[#6b7a70]">
              {role ? ROLE_LABELS[role] : ''}{schoolName ? `, ${schoolName}` : ''}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
