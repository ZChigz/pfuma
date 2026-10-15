import Link from 'next/link';
import { can, type AccessUser, type PermissionKey } from '@/lib/access-core';

const ACTIONS: { label: string; href: string; permission: PermissionKey }[] = [
  { label: 'Add user', href: '/system/users?new=1', permission: 'system.users.create' },
  { label: 'Import students', href: '/admin/students', permission: 'students.import' },
  { label: 'Add event', href: '/system/calendar?new=1', permission: 'system.calendar.create' },
  { label: 'Open settings', href: '/system/settings', permission: 'system.settings.view' },
];

// Each button appears only for people who may do it.
export function QuickActions({ user }: { user: AccessUser }) {
  const shown = ACTIONS.filter((a) => can(user, a.permission));
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {shown.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
