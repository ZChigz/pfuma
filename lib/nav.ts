// The sidebar structure. Which groups and items a person sees is decided by can():
// an item shows only when its permission is held, and a whole group disappears when
// its module is switched off for the school. Only Dashboard & System has live pages;
// the other groups list their planned items as "Coming soon".
import { can, type AccessUser, type ModuleKey, type PermissionKey } from '@/lib/access-core';

export interface NavItemDef {
  label: string;
  permission: PermissionKey;
  icon: string;
  /** Missing = the page does not exist yet. */
  href?: string;
}

export interface NavGroupDef {
  module: ModuleKey;
  label: string;
  items: NavItemDef[];
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    module: 'system',
    label: 'Dashboard & System',
    items: [
      { label: 'Dashboard',            href: '/system/dashboard',    permission: 'system.dashboard.view',    icon: 'dashboard' },
      { label: 'Calendar',             href: '/system/calendar',     permission: 'system.calendar.view',     icon: 'calendar' },
      { label: 'School Settings',      href: '/system/settings',     permission: 'system.settings.view',     icon: 'settings' },
      { label: 'Users',                href: '/system/users',        permission: 'system.users.view',        icon: 'users' },
      { label: 'Roles & Permissions',  href: '/system/roles',        permission: 'system.roles.view',        icon: 'shield' },
      { label: 'Audit Log',            href: '/system/audit-log',    permission: 'system.audit.view',        icon: 'audit' },
      { label: 'Subscription',         href: '/system/subscription', permission: 'system.subscription.view', icon: 'card' },
    ],
  },
  {
    module: 'students',
    label: 'Student Information',
    items: [
      { label: 'Students',   permission: 'students.list.view',       icon: 'students' },
      { label: 'Admissions', permission: 'students.admissions.view', icon: 'marks' },
      { label: 'Guardians',  permission: 'students.guardians.view',  icon: 'users' },
      { label: 'Attendance', permission: 'students.attendance.view', icon: 'calendar' },
      { label: 'Promotions', permission: 'students.promotions.view', icon: 'classes' },
    ],
  },
  {
    module: 'academics',
    label: 'Academics',
    items: [
      { label: 'Classes & Streams',  permission: 'academics.classes.view',    icon: 'classes' },
      { label: 'Subjects',           permission: 'academics.subjects.view',   icon: 'subjects' },
      { label: 'Timetable',          permission: 'academics.timetable.view',  icon: 'calendar' },
      { label: 'Teacher Allocation', permission: 'academics.allocation.view', icon: 'users' },
    ],
  },
  {
    module: 'exams',
    label: 'Examinations',
    items: [
      { label: 'Mark Entry',       permission: 'exams.marks.view',   icon: 'marks' },
      { label: 'Results',          permission: 'exams.results.view', icon: 'results' },
      { label: 'Report Cards',     permission: 'exams.reports.view', icon: 'reports' },
      { label: 'Grade Boundaries', permission: 'exams.grading.view', icon: 'results' },
    ],
  },
  {
    module: 'finance',
    label: 'Finance',
    items: [
      { label: 'Fees',              permission: 'finance.fees.view',     icon: 'payments' },
      { label: 'Payments',          permission: 'finance.payments.view', icon: 'payments' },
      { label: 'Expenses',          permission: 'finance.expenses.view', icon: 'expenses' },
      { label: 'Expense Requests',  permission: 'finance.requests.view', icon: 'expenses' },
      { label: 'Exchange Rates',    permission: 'finance.rates.view',    icon: 'payments' },
      { label: 'Finance Reports',   permission: 'finance.reports.view',  icon: 'reports' },
    ],
  },
  {
    module: 'hr',
    label: 'HR & Staff',
    items: [
      { label: 'Staff Records', permission: 'hr.staff.view',   icon: 'users' },
      { label: 'Leave',         permission: 'hr.leave.view',   icon: 'calendar' },
      { label: 'Payroll',       permission: 'hr.payroll.view', icon: 'payments' },
    ],
  },
  {
    module: 'facilities',
    label: 'Facilities & Operations',
    items: [
      { label: 'Assets',    permission: 'facilities.assets.view',    icon: 'assets' },
      { label: 'Library',   permission: 'facilities.library.view',   icon: 'library' },
      { label: 'Inventory', permission: 'facilities.inventory.view', icon: 'assets' },
    ],
  },
  {
    module: 'communication',
    label: 'Communication',
    items: [
      { label: 'Announcements',      permission: 'communication.announcements.view', icon: 'bell' },
      { label: 'SMS & WhatsApp',     permission: 'communication.messages.view',      icon: 'reports' },
      { label: 'Parent Portal',      permission: 'communication.portal.view',        icon: 'students' },
    ],
  },
];

export interface NavItem {
  label: string;
  icon: string;
  href: string | null;
  comingSoon: boolean;
}

export interface NavGroup {
  module: string;
  label: string;
  items: NavItem[];
}

/** The groups and items this user may see, in order. */
export function buildNav(user: AccessUser): NavGroup[] {
  return NAV_GROUPS.flatMap((g) => {
    if (user.disabledModules?.includes(g.module) && g.module !== 'system') return [];
    const items = g.items
      .filter((i) => can(user, i.permission))
      .map((i) => ({ label: i.label, icon: i.icon, href: i.href ?? null, comingSoon: !i.href }));
    return items.length ? [{ module: g.module, label: g.label, items }] : [];
  });
}
