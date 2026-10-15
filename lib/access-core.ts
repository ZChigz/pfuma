// The permission check, with no database or framework imports so tests, server
// code and client code can all share it. lib/access.ts adds the server helpers
// (requirePermission, getAccess) and re-exports everything here.
//
// Pages, menu items, buttons and API routes ask `can(user, 'system.users.create')`;
// they never look at a role name. Who holds which permission is decided here and
// in the RolePermission table, so a new access level is a data change.
import type { UserRole } from '@/types';

// ─── Modules ─────────────────────────────────────────────────────────────────

export const MODULES = [
  { key: 'system',        label: 'Dashboard & System' },
  { key: 'students',      label: 'Student Information' },
  { key: 'academics',     label: 'Academics' },
  { key: 'exams',         label: 'Examinations' },
  { key: 'finance',       label: 'Finance' },
  { key: 'hr',            label: 'HR & Staff' },
  { key: 'facilities',    label: 'Facilities & Operations' },
  { key: 'communication', label: 'Communication' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export const MODULE_KEYS: readonly string[] = MODULES.map((m) => m.key);

/** The System module holds the switches themselves, so it cannot be switched off. */
export const ALWAYS_ON_MODULES: readonly string[] = ['system'];

// ─── Permission catalogue ────────────────────────────────────────────────────
// key → label. The first segment is the module. `account.*` keys are self-service:
// every signed-in user holds them (their own profile, password, notifications).

export const PERMISSIONS = {
  'system.dashboard.view':      'View the dashboard',
  'system.calendar.view':       'View the school calendar',
  'system.calendar.create':     'Add calendar events',
  'system.calendar.update':     'Edit calendar events',
  'system.calendar.delete':     'Delete calendar events',
  'system.settings.view':       'View school settings',
  'system.settings.update':     'Change school settings',
  'system.users.view':          'View users',
  'system.users.create':        'Add users',
  'system.users.update':        'Edit users and roles',
  'system.users.deactivate':    'Deactivate and reactivate users',
  'system.users.reset_password': 'Reset user passwords',
  'system.users.export':        'Export the user list',
  'system.roles.view':          'View roles and permissions',
  'system.audit.view':          'View the audit log',
  'system.audit.export':        'Export the audit log',
  'system.subscription.view':   'View the subscription',
  'system.subscription.manage': 'Switch modules on and off',

  'students.list.view':         'View students',
  'students.admissions.view':   'View admissions',
  'students.guardians.view':    'View guardians',
  'students.attendance.view':   'View attendance',
  'students.promotions.view':   'View promotions',

  'academics.classes.view':     'View classes and streams',
  'academics.subjects.view':    'View subjects',
  'academics.timetable.view':   'View the timetable',
  'academics.allocation.view':  'View teacher allocation',

  'exams.marks.view':           'View mark entry',
  'exams.results.view':         'View results',
  'exams.reports.view':         'View report cards',
  'exams.grading.view':         'View grade boundaries',

  'finance.fees.view':          'View fees',
  'finance.payments.view':      'View payments',
  'finance.expenses.view':      'View expenses',
  'finance.requests.view':      'View expense requests',
  'finance.rates.view':         'View exchange rates',
  'finance.reports.view':       'View finance reports',

  'hr.staff.view':              'View staff records',
  'hr.leave.view':              'View leave',
  'hr.payroll.view':            'View payroll',

  'facilities.assets.view':     'View assets',
  'facilities.library.view':    'View the library',
  'facilities.inventory.view':  'View inventory',

  'communication.announcements.view': 'View announcements',
  'communication.messages.view':      'View SMS and WhatsApp messages',
  'communication.portal.view':        'View the parent portal',

  'account.profile.view':       'View my profile',
  'account.profile.update':     'Change my profile',
  'account.password.change':    'Change my password',
  'account.notifications.view': 'See my notifications',
  'account.term.view':          'Switch the term I am viewing',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** The module a permission belongs to ('account' for self-service keys). */
export function moduleOf(permission: string): string {
  return permission.split('.')[0] ?? '';
}

const isSelfService = (permission: string) => moduleOf(permission) === 'account';

// ─── can() ───────────────────────────────────────────────────────────────────

/**
 * Roles that hold every permission for now: the School Administrator (ADMIN) and
 * the school owner (DIRECTOR). Everyone else holds only what RolePermission rows
 * grant them, which is nothing yet.
 */
export const FULL_ACCESS_ROLES: readonly UserRole[] = ['ADMIN', 'DIRECTOR'];

export interface AccessUser {
  id: string;
  schoolId: string;
  role: UserRole;
  /** Modules switched off for the user's school. */
  disabledModules?: readonly string[];
  /** Permission keys granted to the user's role (RolePermission rows). */
  grants?: readonly string[];
}

/** Narrows a check, e.g. to one school. A scope naming another school is never allowed. */
export interface AccessScope {
  schoolId?: string;
}

export function can(user: AccessUser | null | undefined, permission: string, scope?: AccessScope): boolean {
  if (!user) return false;
  if (!(permission in PERMISSIONS)) return false; // a typo must never grant access
  if (scope?.schoolId !== undefined && scope.schoolId !== user.schoolId) return false;

  if (isSelfService(permission)) return true;

  const mod = moduleOf(permission);
  if (!ALWAYS_ON_MODULES.includes(mod) && user.disabledModules?.includes(mod)) return false;

  if (FULL_ACCESS_ROLES.includes(user.role)) return true;
  return user.grants?.includes(permission) ?? false;
}

/** Turns the rows that say which modules are on into the list of switched-off ones. */
export function disabledModulesFrom(rows: { module: string; enabled: boolean }[]): string[] {
  return rows.filter((r) => !r.enabled && !ALWAYS_ON_MODULES.includes(r.module)).map((r) => r.module);
}
