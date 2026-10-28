// The sections of the hostel a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const ANY: PermissionKey[] = ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'];
const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/hostel', label: 'Hostels', perms: ANY },
  { href: '/facilities/hostel/rollcall', label: 'Roll call', perms: ['facilities.hostel.rollcall', 'facilities.hostel.view'] },
  { href: '/facilities/hostel/inspections', label: 'Inspections', perms: ['facilities.hostel.inspect', 'facilities.hostel.manage', 'facilities.hostel.view'] },
  { href: '/facilities/exeats', label: 'Exeats', perms: ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout'] },
];

export function HostelNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Hostel sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
