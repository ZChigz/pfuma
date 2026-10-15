'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';

interface UserMenuProps {
  fullName: string;
  roleLabel: string;
  canViewProfile: boolean;
  canChangePassword: boolean;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

const itemClass = 'flex min-h-[44px] w-full items-center rounded-xl px-3 text-left text-sm text-ink hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function UserMenu({ fullName, roleLabel, canViewProfile, canChangePassword }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Account menu for ${fullName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      >
        {initials(fullName)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-60 rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_-8px_rgba(20,48,31,0.25)]">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-ink">{fullName}</p>
            <p className="truncate text-xs text-muted">{roleLabel}</p>
          </div>
          {canViewProfile && <Link role="menuitem" href="/system/profile" onClick={() => setOpen(false)} className={itemClass}>My profile</Link>}
          {canChangePassword && <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className={itemClass}>Change password</Link>}
          <button role="menuitem" type="button" onClick={() => signOut({ callbackUrl: '/login' })} className={itemClass}>Log out</button>
        </div>
      )}
    </div>
  );
}
