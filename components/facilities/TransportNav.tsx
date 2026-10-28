// The sections of Transport a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const ANY: PermissionKey[] = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'];
const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/transport', label: 'Routes', perms: ANY },
  { href: '/facilities/transport/trips', label: 'Trips and fuel', perms: ANY },
  { href: '/facilities/transport/fleet', label: 'Vehicles and drivers', perms: ANY },
  { href: '/facilities/transport/bookings', label: 'Bookings', perms: ANY },
  { href: '/facilities/transport/report', label: 'Report', perms: ANY },
];

export function TransportNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Transport sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
