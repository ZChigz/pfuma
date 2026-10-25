// The sections of the library a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const ANY: PermissionKey[] = ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'];
const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/library', label: 'Catalogue', perms: ANY },
  { href: '/facilities/library/desk', label: 'Desk', perms: ['facilities.library.desk', 'facilities.library.manage', 'facilities.library.view'] },
  { href: '/facilities/library/textbooks', label: 'Textbooks', perms: ['facilities.textbooks.issue', 'facilities.library.manage', 'facilities.library.view'] },
  { href: '/facilities/library/stocktake', label: 'Stocktake', perms: ['facilities.library.manage'] },
  { href: '/facilities/library/reports', label: 'Reports', perms: ANY },
];

export function LibraryNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Library sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
