'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/lib/sidebar-store';
import { termLabel } from '@/lib/term-label';
import type { NavGroup } from '@/lib/nav';
import { EXACT_MATCH_ROUTES, icons, type Workspace } from './nav-config';

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

interface SidebarProps {
  /** Groups the user may see (lib/nav.ts buildNav). */
  groups: NavGroup[];
  /** "My work", shown first: the user's own pages plus the Dashboard & System pages (built in DashboardShell). */
  workspace: Workspace | null;
  openTermName?: string;
}

export function Sidebar({ groups, workspace, openTermName }: SidebarProps) {
  const pathname = usePathname();
  const { isMobileExpanded, collapsed, close, toggleCollapsed, restore } = useSidebarStore();

  useEffect(() => { restore(); }, [restore]);

  const isActive = (href: string) => pathname === href || (!EXACT_MATCH_ROUTES.has(href) && pathname.startsWith(`${href}/`));
  // On a phone the drawer is always full width with labels; "collapsed" only applies from md up.
  const label = cn(collapsed && 'md:hidden');

  const linkClass = (active: boolean) =>
    cn(
      'relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      collapsed && 'md:justify-center md:px-0',
      active ? 'font-semibold text-ink' : 'font-medium text-subtle hover:bg-white/70 hover:text-ink',
    );

  return (
    <>
      {isMobileExpanded && <div className="fixed inset-0 z-40 bg-ink/40 md:hidden" onClick={close} aria-hidden="true" />}

      <aside
        aria-label="Sidebar"
        className={cn(
          'z-50 flex flex-col rounded-2xl bg-canvas p-4 transition-[transform,width] duration-200',
          'fixed inset-y-3 left-3 w-64 md:static md:inset-auto md:flex-shrink-0 md:translate-x-0',
          collapsed ? 'md:w-[76px] md:px-2' : 'md:w-60',
          isMobileExpanded ? 'translate-x-0' : '-translate-x-[120%]',
        )}
      >
        <div className={cn('flex items-center gap-2.5 px-1 pb-5 pt-1', collapsed && 'md:justify-center')}>
          <Logo />
          <div className={cn('min-w-0', label)}>
            <p className="text-lg font-bold leading-none tracking-tight text-ink">Pfuma</p>
            <p className="mt-1 truncate text-xs text-muted">School management</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto" aria-label="Main navigation">
          {workspace && workspace.sections.length > 0 && (
            <div className="mb-5">
              <p className={cn('mb-1.5 px-3 text-xs font-medium text-subtle', label)}>My work &middot; {workspace.header}</p>
              {collapsed && <div className="mx-3 mb-1.5 hidden border-t border-line md:block" aria-hidden="true" />}
              {workspace.sections.flatMap((s) => s.items).filter((item, i, all) => all.findIndex((x) => x.href === item.href) === i).map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} title={item.label} onClick={() => close()} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                    {active && <span className="absolute -left-4 bottom-2 top-2 w-1 rounded-r-full bg-primary" aria-hidden="true" />}
                    <Icon path={icons[item.icon] ?? icons.dashboard} className={active ? 'text-primary' : ''} />
                    <span className={cn('truncate', label)}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.module} className="mb-5">
              <p className={cn('mb-1.5 px-3 text-xs font-medium text-subtle', label)}>{group.label}</p>
              {collapsed && <div className="mx-3 mb-1.5 hidden border-t border-line md:block" aria-hidden="true" />}
              {group.items.map((item) => {
                const content = (
                  <>
                    <Icon path={icons[item.icon] ?? icons.dashboard} />
                    <span className={cn('truncate', label)}>{item.label}</span>
                    {item.comingSoon && (
                      <span className={cn('ml-auto flex-shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-subtle', label)}>
                        Coming soon
                      </span>
                    )}
                  </>
                );
                if (!item.href) {
                  return (
                    <div key={item.label} aria-disabled="true" title={`${item.label} (coming soon)`} className={cn(linkClass(false), 'cursor-default opacity-70 hover:bg-transparent hover:text-subtle')}>
                      {content}
                    </div>
                  );
                }
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} title={item.label} onClick={() => close()} aria-current={active ? 'page' : undefined} className={linkClass(active)}>
                    {active && <span className="absolute -left-4 bottom-2 top-2 w-1 rounded-r-full bg-primary" aria-hidden="true" />}
                    {content}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="mb-3 hidden min-h-[44px] items-center justify-center gap-2 rounded-xl text-xs font-medium text-subtle hover:bg-white/70 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:flex"
        >
          <svg className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons.chevron} /></svg>
          {!collapsed && 'Collapse'}
        </button>

        {/* Term card: the one dark surface in the chrome */}
        <div className={cn('term-card relative overflow-hidden rounded-2xl p-4 text-white', collapsed && 'md:hidden')}>
          <p className="relative text-xs text-emerald-100/80">Open term</p>
          <p className="relative mt-1 text-base font-semibold leading-snug">{openTermName ? termLabel(openTermName) : 'Not set yet'}</p>
        </div>
      </aside>
    </>
  );
}
