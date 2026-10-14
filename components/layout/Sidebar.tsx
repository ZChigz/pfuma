'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/lib/sidebar-store';
import { EXACT_MATCH_ROUTES, ROLE_NAV, icons } from './nav-config';
import type { UserRole } from '@/types';

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      className={cn('h-[18px] w-[18px] flex-shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function Logo() {
  return (
    <svg className="h-8 w-8 flex-shrink-0" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" stroke="#14613f" strokeWidth="3.5" />
      <circle cx="16" cy="16" r="6" fill="#14613f" />
    </svg>
  );
}

export function Sidebar({ currentTerm }: { currentTerm?: string }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isMobileExpanded, close } = useSidebarStore();
  const role = session?.user?.role as UserRole | undefined;
  const nav = role ? ROLE_NAV[role] : null;

  function isActive(href: string) {
    if (EXACT_MATCH_ROUTES.has(href)) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {isMobileExpanded && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'z-50 flex flex-col rounded-2xl bg-canvas p-4 transition-transform duration-200',
          // Desktop: sits in the frame. Mobile: slide-in drawer.
          'fixed inset-y-3 left-3 w-64 md:static md:inset-auto md:w-60 md:flex-shrink-0 md:translate-x-0',
          isMobileExpanded ? 'translate-x-0' : '-translate-x-[120%]',
        )}
      >
        <div className="flex items-center gap-2.5 px-1 pb-6 pt-1">
          <Logo />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-none tracking-tight text-ink">Pfuma</p>
            <p className="mt-1 truncate text-xs text-muted">{nav?.header ?? 'School management'}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto" aria-label="Main navigation">
          {nav?.sections.map((section) => (
            <div key={section.title} className="mb-5">
              <p className="mb-1.5 px-3 text-xs font-medium text-subtle">{section.title}</p>
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => close()}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      active
                        ? 'font-semibold text-ink'
                        : 'font-medium text-subtle hover:bg-white/70 hover:text-ink',
                    )}
                  >
                    {active && (
                      <span className="absolute -left-4 bottom-2 top-2 w-1 rounded-r-full bg-primary" aria-hidden="true" />
                    )}
                    <Icon path={icons[item.icon]} className={active ? 'text-primary' : ''} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="mb-5">
            <p className="mb-1.5 px-3 text-xs font-medium text-subtle">Account</p>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-subtle transition-colors hover:bg-white/70 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon path={icons.signout} />
              Sign out
            </button>
          </div>
        </nav>

        {/* Term card: the one dark surface in the chrome */}
        <div className="term-card relative overflow-hidden rounded-2xl p-4 text-white">
          <p className="relative text-xs text-emerald-100/80">Current term</p>
          <p className="relative mt-1 text-base font-semibold leading-snug">
            {currentTerm || 'Not set yet'}
          </p>
        </div>
      </aside>
    </>
  );
}
