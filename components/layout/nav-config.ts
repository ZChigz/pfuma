import { can, type AccessUser, type PermissionKey } from '@/lib/access-core';
import type { UserRole } from '@/types';

export const icons: Record<string, string> = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  students:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  payments:  'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  expenses:  'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  results:   'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  subjects:  'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  marks:     'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  reports:   'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  assets:    'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  library:   'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  classes:   'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222',
  signout:   'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  calendar:  'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
};

// ─── The older screens ──────────────────────────────────────────────────────
// Screens written before roles were data (the Head's office, the Bursar's desk, the teacher's mark entry ...). The sidebar lists the ones
// a person may use, each by the permission that opens it, never by a role name; the page and the routes behind it check the same key.

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof icons;
  /** Shown to, and opened by, anyone holding this permission ... */
  permission: PermissionKey;
  /** ... or any of these. */
  or?: PermissionKey[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export interface Workspace {
  header: string;
  sections: NavSection[];
}

export const LEGACY_SECTIONS: NavSection[] = [
  {
    title: 'Setup',
    items: [
      { href: '/admin',          label: 'Dashboard',         icon: 'dashboard', permission: 'system.users.view' },
      { href: '/admin/classes',  label: 'Classes',           icon: 'classes',   permission: 'academics.classes.manage' },
      { href: '/admin/subjects', label: 'Subjects',          icon: 'subjects',  permission: 'academics.subjects.manage' },
      { href: '/admin/academic', label: 'Academic calendar', icon: 'calendar',  permission: 'system.settings.edit' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/director',       label: 'Profitability',    icon: 'dashboard', permission: 'finance.reports.view' },
      { href: '/director/voids', label: 'Void Entries',     icon: 'expenses',  permission: 'finance.payments.void' },
      { href: '/head',           label: 'Dashboard',        icon: 'dashboard', permission: 'finance.dashboard.view' },
      { href: '/head/fees',      label: 'Fee Management',   icon: 'payments',  permission: 'finance.fees.approve' },
      { href: '/head/payments',  label: 'Payments',         icon: 'payments',  permission: 'finance.payments.verify' },
      { href: '/head/expenses',  label: 'Expenses',         icon: 'expenses',  permission: 'finance.expenses.view' },
      { href: '/head/requests',  label: 'Expense Requests', icon: 'expenses',  permission: 'finance.requests.approve' },
    ],
  },
  {
    title: 'Academic',
    items: [
      { href: '/head/results', label: 'Results', icon: 'results', permission: 'exams.results.publish' },
      { href: '/head/reports', label: 'Reports', icon: 'reports', permission: 'exams.results.view' },
    ],
  },
  {
    title: 'Daily Work',
    items: [
      { href: '/bursar/students',      label: 'Students',        icon: 'students', permission: 'finance.accounts.view' },
      { href: '/bursar/payments',      label: 'Record Payment',  icon: 'payments', permission: 'finance.payments.record' },
      { href: '/bursar/disbursements', label: 'Disbursements',   icon: 'expenses', permission: 'finance.requests.disburse' },
      { href: '/bursar/expenses',      label: 'Direct Expenses', icon: 'expenses', permission: 'finance.expenses.record' },
    ],
  },
  {
    title: 'Teaching',
    items: [
      { href: '/teacher/marks',    label: 'Mark Entry', icon: 'marks',    permission: 'exams.marks.enter' },
      { href: '/teacher/classes',  label: 'My Classes', icon: 'classes',  permission: 'academics.classes.view' },
      { href: '/teacher/requests', label: 'Requests',   icon: 'expenses', permission: 'finance.requests.create' },
    ],
  },
  {
    title: 'Library',
    items: [
      { href: '/library',           label: 'Dashboard', icon: 'dashboard', permission: 'facilities.library.view' },
      { href: '/library/catalog',   label: 'Catalog',   icon: 'library',   permission: 'facilities.library.view' },
      { href: '/library/borrowing', label: 'Checkout',  icon: 'students',  permission: 'facilities.library.desk' },
    ],
  },
];

/**
 * The older screens this person may use. A key held only through the temporary "*" does not count here, so an Owner or Administrator
 * is not shown every desk in the building; once "*" is gone the two lists are the same.
 */
export function workspaceFor(user: AccessUser, header: string): Workspace | null {
  const held = (k: PermissionKey) => can(user, k) && (!user.effective || user.effective.grants.has(k));
  const sections = LEGACY_SECTIONS
    .map((s) => ({ title: s.title, items: s.items.filter((i) => held(i.permission) || (i.or ?? []).some(held)) }))
    .filter((s) => s.items.length > 0);
  return sections.length ? { header, sections } : null;
}

/** Labels for the older single access level (shown on the older Users screen). Not used to decide anything. */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN:     'Admin',
  DIRECTOR:  'Director',
  HEAD:      'Head Teacher',
  BURSAR:    'Bursar',
  TEACHER:   'Teacher',
  LIBRARIAN: 'Librarian',
};

// Routes that have nested sub-pages need exact matching on their root
// so the parent link isn't highlighted while viewing a child page.
export const EXACT_MATCH_ROUTES = new Set(['/admin', '/director', '/library']);

// Icons used by the Dashboard & System shell.
Object.assign(icons, {
  users:    icons.students,
  card:     icons.payments,
  settings: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  shield:   'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  audit:    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  bell:     'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  chevron:  'M15 19l-7-7 7-7',
});
