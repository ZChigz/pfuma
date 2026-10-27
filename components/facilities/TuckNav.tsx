// The sections of the tuck shop and pocket money a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/tuckshop', label: 'Till', perms: ['facilities.tuckshop.sell'] },
  { href: '/facilities/tuckshop/wallets', label: 'Pocket money', perms: ['facilities.wallets.manage', 'facilities.wallets.view'] },
  { href: '/facilities/tuckshop/cashup', label: 'Cash-up', perms: ['facilities.tuckshop.sell', 'facilities.tuckshop.cashup'] },
];

export function TuckNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Tuck shop sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
