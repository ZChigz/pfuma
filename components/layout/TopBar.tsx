'use client';

import { useSidebarStore } from '@/lib/sidebar-store';

interface TopBarProps {
  schoolName: string;
  currentTerm?: string;
}

export function TopBar({ schoolName, currentTerm }: TopBarProps) {
  const { toggle } = useSidebarStore();

  return (
    <header className="fixed left-16 right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-[#e7e5e4] bg-white px-4 shadow-sm md:left-64">
      {/* Hamburger — visible only on mobile */}
      <button
        onClick={toggle}
        aria-label="Toggle navigation menu"
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-[#78716c] transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 md:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6"  x2="21" y2="6"  />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* School name — absolutely centred */}
      <p className="absolute left-1/2 -translate-x-1/2 truncate text-sm font-semibold text-[#292524]">
        {schoolName}
      </p>

      {/* Current term — right-aligned */}
      <div className="ml-auto">
        {currentTerm && (
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-[#78716c]">
            {currentTerm}
          </span>
        )}
      </div>
    </header>
  );
}
