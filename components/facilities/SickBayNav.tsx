// The sections of the sick bay a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/sickbay', label: 'Visits', perms: ['facilities.sickbay.record', 'facilities.sickbay.view'] },
  { href: '/facilities/sickbay/round', label: 'Medication round', perms: ['facilities.sickbay.record'] },
  { href: '/facilities/inventory', label: 'Stock', perms: ['facilities.inventory.view', 'facilities.inventory.issue'] },
];

export function SickBayNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Sick bay sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
