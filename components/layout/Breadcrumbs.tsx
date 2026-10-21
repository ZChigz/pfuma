'use client';

import { Fragment, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCrumbStore } from '@/lib/crumb-store';
import { ROLE_NAV } from './nav-config';
import type { UserRole } from '@/types';

/** Where "/" sends each role. The home page itself shows no breadcrumb. */
const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: '/admin',
  DIRECTOR: '/director',
  HEAD: '/head',
  BURSAR: '/bursar/students',
  TEACHER: '/teacher/marks',
  LIBRARIAN: '/library',
};

// Pages that exist but are not in the sidebar.
const EXTRA_LABELS: Record<string, string> = {
  '/assets': 'Assets',
  '/accounting/settings': 'Settings',
  '/accounting/students': 'Students',
  '/results/reports': 'Report cards',
};

// A trail segment whose own page does not exist links to the closest page that does.
const LINK_ALIASES: Record<string, string> = {
  '/accounting/students': '/bursar/students',
};

const STATIC_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = { ...EXTRA_LABELS };
  for (const role of Object.values(ROLE_NAV)) {
    for (const section of role.sections) {
      for (const item of section.items) map[item.href] ??= item.label;
    }
  }
  return map;
})();

interface Crumb {
  label: string;
  href?: string;
}

function buildTrail(pathname: string, dynamic: Record<string, string>): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const trail: Crumb[] = [];
  let path = '';
  segments.forEach((seg, i) => {
    path += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = STATIC_LABELS[path] ?? dynamic[path];
    if (label) trail.push({ label, href: isLast ? undefined : LINK_ALIASES[path] ?? path });
    // Dynamic page still loading its name, or a folder with no page: only the last segment is shown.
    else if (isLast) trail.push({ label: 'Details' });
  });
  return trail;
}

/** Registers a readable name for the current dynamic route, e.g. a student's name. */
export function CrumbLabel({ label }: { label: string }) {
  const pathname = usePathname();
  const set = useCrumbStore((s) => s.set);
  const clear = useCrumbStore((s) => s.clear);
  useEffect(() => {
    set(pathname, label);
    return () => clear(pathname);
  }, [pathname, label, set, clear]);
  return null;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const dynamic = useCrumbStore((s) => s.labels);
  const role = session?.user?.role as UserRole | undefined;

  if (!role || pathname === ROLE_HOME[role]) return null;
  const trail = buildTrail(pathname, dynamic);
  if (trail.length === 0) return null;

  const all: Crumb[] = [{ label: 'Dashboard', href: '/' }, ...trail];

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {all.map((c, i) => {
          const last = i === all.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <li className="min-w-0">
                {c.href && !last ? (
                  <Link href={c.href} className="rounded text-muted transition-colors hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="block max-w-[28ch] truncate font-semibold text-ink sm:max-w-[48ch]">
                    {c.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-subtle">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
