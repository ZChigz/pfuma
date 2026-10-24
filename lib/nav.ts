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
      { label: 'Overview',          href: '/finance',             permission: 'finance.reports.view',  or: ['finance.accounts.view', 'finance.payments.view', 'finance.payments.verify', 'finance.requests.approve', 'finance.requests.disburse'], icon: 'dashboard' },
      { label: 'Student accounts',  href: '/finance/accounts',    permission: 'finance.accounts.view', or: ['finance.payments.record', 'finance.charges.create'], icon: 'students' },
      { label: 'Fees',              href: '/finance/fees',        permission: 'finance.fees.view',     or: ['finance.fees.manage', 'finance.fees.approve', 'finance.charges.create'], icon: 'payments' },
      { label: 'Billing',           href: '/finance/billing',     permission: 'finance.billing.run',   icon: 'payments' },
      { label: 'Invoices',          href: '/finance/invoices',    permission: 'finance.statements.view', or: ['finance.billing.run'], icon: 'reports' },
      { label: 'Discounts',         href: '/finance/discounts',   permission: 'finance.adjustments.approve', or: ['finance.adjustments.create'], icon: 'shield' },
      { label: 'Sponsors',          href: '/finance/sponsors',    permission: 'finance.sponsors.manage', or: ['finance.awards.approve'], icon: 'students' },
      { label: 'Arrears',           href: '/finance/arrears',     permission: 'finance.statements.view', or: ['finance.accounts.view'], icon: 'reports' },
      { label: 'Payment plans',     href: '/finance/plans',       permission: 'finance.plans.manage',  or: ['finance.plans.approve'], icon: 'payments' },
      { label: 'Payments',          href: '/finance/payments',    permission: 'finance.payments.view', or: ['finance.payments.record', 'finance.payments.verify'], icon: 'payments' },
      { label: 'Credit notes',      href: '/finance/adjustments', permission: 'finance.adjustments.approve', or: ['finance.adjustments.create'], icon: 'shield' },
      { label: 'Refunds',           href: '/finance/refunds',     permission: 'finance.refunds.approve', or: ['finance.refunds.request', 'finance.refunds.pay'], icon: 'payments' },
      { label: 'Expense requests',  href: '/finance/requests',    permission: 'finance.requests.create', or: ['finance.requests.view', 'finance.requests.approve', 'finance.requests.disburse'], icon: 'expenses' },
      { label: 'Expenses',          href: '/finance/expenses',    permission: 'finance.expenses.view', or: ['finance.expenses.record'], icon: 'expenses' },
      { label: 'Suppliers',         href: '/finance/suppliers',   permission: 'finance.suppliers.manage', icon: 'expenses' },
      { label: 'Budgets',           href: '/finance/budgets',     permission: 'finance.budgets.manage', or: ['finance.expenses.view'], icon: 'expenses' },
      { label: 'Petty cash',        href: '/finance/petty-cash',  permission: 'finance.expenses.manage', or: ['finance.expenses.record'], icon: 'expenses' },
      { label: 'Payroll',           href: '/finance/payroll',     permission: 'finance.payroll.pay',   icon: 'expenses' },
      { label: 'Daily cash-up',     href: '/finance/cash-up',     permission: 'finance.cashup.submit', or: ['finance.cashup.confirm', 'finance.cashup.signoff'], icon: 'payments' },
      { label: 'Bank reconciliation', href: '/finance/bank',      permission: 'finance.bank.reconcile', icon: 'payments' },
      { label: 'Reports',           href: '/finance/reports',     permission: 'finance.reports.view',  icon: 'reports' },
      { label: 'Exchange rates',    href: '/finance/rates',       permission: 'finance.rates.view',    or: ['finance.rates.manage'], icon: 'payments' },
      { label: 'Funds & controls',  href: '/finance/settings',    permission: 'finance.funds.manage',  or: ['finance.settings.manage'], icon: 'settings' },
    ],
  },
  {
    module: 'hr',
    label: 'HR & Staff',
    items: [
      { label: 'Overview',      href: '/hr',            permission: 'hr.directory.view', or: ['hr.self.details'], icon: 'dashboard' },
      { label: 'Staff',         href: '/hr/staff',      permission: 'hr.directory.view', or: ['hr.employees.view'], icon: 'users' },
      { label: 'Posts & recruitment', href: '/hr/posts', permission: 'hr.posts.manage', or: ['hr.posts.approve', 'hr.recruitment.manage'], icon: 'users' },
      { label: 'Contracts',     href: '/hr/contracts',  permission: 'hr.contracts.manage', icon: 'marks' },
      { label: 'Staff attendance', href: '/hr/attendance', permission: 'hr.attendance.mark', or: ['hr.attendance.view'], icon: 'calendar' },
      { label: 'Leave',         href: '/hr/leave',      permission: 'hr.leave.view_all', or: ['hr.leave.approve'], icon: 'calendar' },
      { label: 'Duty roster',   href: '/hr/duties',     permission: 'hr.duties.view', or: ['hr.duties.manage', 'hr.duties.approve'], icon: 'calendar' },
      { label: 'Payroll',       href: '/hr/payroll',    permission: 'hr.payroll.view', or: ['hr.payroll.prepare', 'hr.payroll.approve'], icon: 'payments' },
      { label: 'HR reports',    href: '/hr/reports',    permission: 'hr.reports.view', or: ['hr.payroll.view'], icon: 'reports' },
      { label: 'My HR',         href: '/hr/me',         permission: 'hr.self.details', icon: 'users' },
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
