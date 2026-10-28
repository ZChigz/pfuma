// The sections of the asset register a person can open (a server component: plain links).
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const ANY: PermissionKey[] = ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'];
const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/facilities/assets', label: 'Register', perms: ANY },
  { href: '/facilities/assets/mine', label: 'Mine', perms: ANY },
  { href: '/facilities/assets/jobs', label: 'Faults', perms: ANY },
  { href: '/facilities/assets/disposals', label: 'Disposals', perms: ['facilities.assets.dispose', 'facilities.assets.manage', 'facilities.assets.view'] },
  { href: '/facilities/assets/verify', label: 'Verify', perms: ['facilities.assets.verify', 'facilities.assets.manage', 'facilities.assets.view'] },
  { href: '/facilities/assets/reports', label: 'Reports', perms: ANY },
];

export function AssetNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="Asset sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[44px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}
