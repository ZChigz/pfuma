'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { useSidebarStore } from '@/lib/sidebar-store';
import type { UserRole } from '@/types';

// ─── Icons ───────────────────────────────────────────────────────────────────

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 flex-shrink-0', className)}
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

const icons = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  students:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  payments:  'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  expenses:  'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  results:   'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  subjects:  'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  marks:     'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  reports:   'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  assets:    'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  library:   'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  signout:   'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  settings:  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

// ─── Nav config ──────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof icons;
  roles?: UserRole[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: 'Finance',
    items: [
      { href: '/accounting',          label: 'Dashboard', icon: 'dashboard' },
      { href: '/accounting/settings', label: 'Settings',  icon: 'settings',  roles: ['DIRECTOR', 'HEAD', 'BURSAR'] },
    ],
  },
  {
    title: 'Students',
    items: [
      { href: '/accounting/students', label: 'Students', icon: 'students' },
      { href: '/accounting/payments', label: 'Payments', icon: 'payments' },
      { href: '/accounting/expenses', label: 'Expenses', icon: 'expenses' },
    ],
  },
  {
    title: 'Academic',
    items: [
      { href: '/results',          label: 'Results',     icon: 'results'  },
      { href: '/results/subjects', label: 'Subjects',    icon: 'subjects', roles: ['DIRECTOR', 'HEAD'] },
      { href: '/results/marks',    label: 'Mark Entry',  icon: 'marks',    roles: ['DIRECTOR', 'HEAD', 'TEACHER'] },
      { href: '/results/reports',  label: 'Reports',     icon: 'reports'  },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/assets',  label: 'Assets',  icon: 'assets',  roles: ['DIRECTOR', 'HEAD', 'BURSAR'] },
      { href: '/library', label: 'Library', icon: 'library', roles: ['DIRECTOR', 'HEAD', 'LIBRARIAN'] },
    ],
  },
];

const ROLE_LABELS: Record<UserRole, string> = {
  DIRECTOR:  'Director',
  HEAD:      'Head Teacher',
  BURSAR:    'Bursar',
  TEACHER:   'Teacher',
  LIBRARIAN: 'Librarian',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isMobileExpanded, close } = useSidebarStore();
  const role = session?.user?.role as UserRole | undefined;

  function isActive(href: string) {
    if (href === '/accounting') return pathname === '/accounting';
    if (href === '/results')    return pathname === '/results';
    return pathname.startsWith(href);
  }

  const visibleSections = sections.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.roles || (role && item.roles.includes(role)),
    ),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileExpanded && (
        <div
          className="fixed inset-0 z-30 bg-[#292524]/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen flex-col bg-[#065f46] transition-all duration-200',
          // Icon-only on mobile unless expanded
          isMobileExpanded ? 'w-64' : 'w-16 md:w-64',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 flex-shrink-0 items-center gap-3 px-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-white/20">
            <span className="text-sm font-bold text-white">P</span>
          </div>
          <div className={cn('overflow-hidden transition-all', isMobileExpanded ? 'w-auto' : 'w-0 md:w-auto')}>
            <p className="whitespace-nowrap text-sm font-bold text-white">Pfuma</p>
            <p className="whitespace-nowrap text-xs text-emerald-200">School Management</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
          {visibleSections.map((section) => (
            <div key={section.title} className="mb-4">
              <p
                className={cn(
                  'mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-300 transition-all',
                  isMobileExpanded ? 'block' : 'hidden md:block',
                )}
              >
                {section.title}
              </p>
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => close()}
                    title={item.label}
                    className={cn(
                      'flex min-h-[44px] items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'border-l-[3px] border-[#f59e0b] bg-white/10 text-white'
                        : 'border-l-[3px] border-transparent text-emerald-100 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon path={icons[item.icon]} className="flex-shrink-0" />
                    <span
                      className={cn(
                        'truncate whitespace-nowrap transition-all',
                        isMobileExpanded ? 'block' : 'hidden md:block',
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="flex-shrink-0 border-t border-white/10 p-3">
          <div
            className={cn(
              'mb-2 flex items-center gap-3 overflow-hidden',
              isMobileExpanded ? 'w-auto' : 'w-auto md:w-auto',
            )}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
              {session?.user?.fullName?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div
              className={cn(
                'min-w-0 flex-1 transition-all',
                isMobileExpanded ? 'block' : 'hidden md:block',
              )}
            >
              <p className="truncate text-xs font-medium text-white">
                {session?.user?.fullName ?? '—'}
              </p>
              {role && (
                <Badge
                  variant="gold"
                  label={ROLE_LABELS[role]}
                  className="mt-0.5 text-[10px]"
                />
              )}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            title="Sign out"
            className={cn(
              'flex min-h-[44px] w-full items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-white/10 hover:text-white',
              'focus:outline-none focus:ring-2 focus:ring-white/40',
            )}
          >
            <Icon path={icons.signout} />
            <span
              className={cn(
                'whitespace-nowrap transition-all',
                isMobileExpanded ? 'block' : 'hidden md:block',
              )}
            >
              Sign out
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
