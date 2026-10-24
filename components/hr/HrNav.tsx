// The row of HR sections a person can open (server component: plain links). Only what their permissions allow is shown.
import Link from 'next/link';
import type { PermissionKey } from '@/lib/access-core';

const SECTIONS: { href: string; label: string; perms: PermissionKey[] }[] = [
  { href: '/hr', label: 'Overview', perms: ['hr.directory.view', 'hr.self.details'] },
  { href: '/hr/staff', label: 'Staff', perms: ['hr.directory.view', 'hr.employees.view'] },
  { href: '/hr/posts', label: 'Posts', perms: ['hr.posts.manage', 'hr.posts.approve'] },
  { href: '/hr/recruitment', label: 'Recruitment', perms: ['hr.recruitment.manage'] },
  { href: '/hr/contracts', label: 'Contracts', perms: ['hr.contracts.manage'] },
  { href: '/hr/attendance', label: 'Attendance', perms: ['hr.attendance.mark', 'hr.attendance.view'] },
  { href: '/hr/leave', label: 'Leave', perms: ['hr.leave.view_all', 'hr.leave.approve'] },
  { href: '/hr/duties', label: 'Duties', perms: ['hr.duties.view', 'hr.duties.manage', 'hr.duties.approve'] },
  { href: '/hr/payroll', label: 'Payroll', perms: ['hr.payroll.view', 'hr.payroll.prepare', 'hr.payroll.approve'] },
  { href: '/hr/reports', label: 'Reports', perms: ['hr.reports.view', 'hr.payroll.view'] },
  { href: '/hr/requests', label: 'Requests', perms: ['hr.employees.manage'] },
  { href: '/hr/me', label: 'My HR', perms: ['hr.self.details'] },
];

export function HrNav({ can, current }: { can: (p: PermissionKey) => boolean; current: string }) {
  return (
    <nav aria-label="HR sections" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {SECTIONS.filter((s) => s.perms.some(can)).map((s) => (
        <Link key={s.href} href={s.href} aria-current={s.href === current ? 'page' : undefined}
          className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${s.href === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{s.label}</Link>
      ))}
    </nav>
  );
}

/** Link-based tabs for a record page. */
export function LinkTabs({ base, current, tabs }: { base: string; current: string; tabs: { id: string; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full bg-white p-1">
      {tabs.map((t) => (
        <Link key={t.id} href={`${base}?tab=${t.id}`} role="tab" aria-selected={t.id === current}
          className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold ${t.id === current ? 'bg-primary text-white' : 'text-muted hover:bg-tint hover:text-ink'}`}>{t.label}</Link>
      ))}
    </div>
  );
}
