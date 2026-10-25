// The sections of Inventory a person can open (a server component: plain links). Only what their permissions allow is shown.
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/inventory', label: 'Stock', perms: ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.issue', 'facilities.inventory.receive', 'facilities.inventory.count', 'facilities.inventory.writeoff'] },
  { href: '/facilities/inventory/receive', label: 'Receive', perms: ['facilities.inventory.receive'] },
  { href: '/facilities/inventory/counts', label: 'Counts', perms: ['facilities.inventory.count', 'facilities.inventory.writeoff'] },
  { href: '/facilities/inventory/approvals', label: 'Approvals', perms: ['facilities.inventory.writeoff', 'facilities.inventory.issue', 'facilities.inventory.count'] },
  { href: '/facilities/inventory/reports', label: 'Reports', perms: ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.writeoff'] },
];

export function InventoryNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Inventory sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
