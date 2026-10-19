// The sidebar structure. Which groups and items a person sees is decided by can():
// an item shows only when its permission is held, and a whole group disappears when
// its module is switched off for the school. Only Dashboard & System has live pages;
// the other groups list their planned items as "Coming soon".
import { can, type AccessUser, type ModuleKey, type PermissionKey } from '@/lib/access-core';

export interface NavItemDef {
  label: string;
  permission: PermissionKey;
  /** The item also shows for anyone holding one of these. */
  or?: PermissionKey[];
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
      { label: 'Students',   href: '/students',            permission: 'students.profiles.view',    icon: 'students' },
      { label: 'Admissions', href: '/students/admissions', permission: 'students.admissions.view',  icon: 'marks' },
      { label: 'Discipline', href: '/students/discipline', permission: 'students.discipline.view',  icon: 'audit' },
      { label: 'Promotion',  href: '/students/promotion',  permission: 'students.promotion.manage', icon: 'classes' },
      { label: 'Leavers',    href: '/students/leavers',    permission: 'students.leavers.manage',   icon: 'users' },
      { label: 'Alumni',     href: '/students/alumni',     permission: 'students.alumni.view',      icon: 'students' },
      { label: 'Attendance', permission: 'students.attendance.view', icon: 'calendar' },
    ],
  },
  {
    module: 'academics',
    label: 'Academics',
    items: [
      { label: 'Classes',            href: '/academics/classes',          permission: 'academics.classes.view',     icon: 'classes' },
      { label: 'Subjects',           href: '/academics/subjects',         permission: 'academics.subjects.view',    icon: 'subjects' },
      { label: 'Student subjects',   href: '/academics/student-subjects', permission: 'academics.classes.view',     icon: 'students' },
      { label: 'Teacher assignments', href: '/academics/assignments',     permission: 'academics.assignments.view', icon: 'users' },
      { label: 'Attendance',         href: '/academics/attendance',       permission: 'academics.attendance.mark',  or: ['academics.attendance.view'], icon: 'calendar' },
      { label: 'Timetable',          href: '/academics/timetable',        permission: 'academics.timetable.view',   icon: 'calendar' },
      { label: 'Schemes of work',    href: '/academics/schemes',          permission: 'academics.schemes.view',     icon: 'marks' },
      { label: 'Syllabus',           href: '/academics/syllabus',         permission: 'academics.syllabus.manage',  or: ['academics.schemes.view'], icon: 'subjects' },
      { label: 'Academics settings', href: '/academics/settings',         permission: 'academics.classes.view',     icon: 'settings' },
      { label: 'Analytics',          href: '/academics/analytics',        permission: 'academics.analytics.view',   icon: 'results' },
    ],
  },
  {
    module: 'exams',
    label: 'Examinations',
    items: [
      { label: 'Overview',          href: '/exams',            permission: 'exams.marks.enter',   or: ['exams.marks.view', 'exams.marks.verify', 'exams.setup.manage', 'exams.results.view', 'exams.timetable.manage', 'exams.zimsec.manage', 'exams.analytics.view'], icon: 'dashboard' },
      { label: 'My marks',          href: '/exams/marks',      permission: 'exams.marks.enter',   icon: 'marks' },
      { label: 'Verify marks',      href: '/exams/verify',     permission: 'exams.marks.verify',  or: ['exams.marks.unlock'], icon: 'shield' },
      { label: 'Mark sheet progress', href: '/exams/progress', permission: 'exams.marks.unlock',  or: ['exams.marks.view', 'exams.setup.manage'], icon: 'results' },
      { label: 'Assessment setup',  href: '/exams/setup',      permission: 'exams.setup.manage',  icon: 'settings' },
      { label: 'Projects',          href: '/exams/projects',   permission: 'exams.projects.manage', or: ['exams.assessments.create'], icon: 'subjects' },
      { label: 'Comments',          href: '/exams/comments',   permission: 'exams.comments.class', or: ['exams.comments.head'], icon: 'marks' },
      { label: 'Results & report cards', href: '/exams/results', permission: 'exams.results.view', or: ['exams.results.publish', 'exams.reports.view'], icon: 'reports' },
      { label: 'Exam timetable',    href: '/exams/timetable',  permission: 'exams.timetable.manage', or: ['exams.timetable.approve', 'exams.invigilation.manage'], icon: 'calendar' },
      { label: 'ZIMSEC & Cambridge', href: '/exams/board',     permission: 'exams.zimsec.manage', or: ['exams.zimsec.approve', 'exams.zimsec.results_import'], icon: 'assets' },
      { label: 'Analytics',         href: '/exams/analytics',  permission: 'exams.analytics.view', icon: 'results' },
      { label: 'Grade boundaries',  href: '/system/settings?tab=grading', permission: 'system.settings.view', icon: 'results' },
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
      .filter((i) => can(user, i.permission) || (i.or ?? []).some((p) => can(user, p)))
      .map((i) => ({ label: i.label, icon: i.icon, href: i.href ?? null, comingSoon: !i.href }));
    return items.length ? [{ module: g.module, label: g.label, items }] : [];
  });
}
