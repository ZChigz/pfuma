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
  // System module: the same keys are rows in the Permission table (migration 20261030000000).
  'system.dashboard.view':      'See the dashboard',
  'system.calendar.view':       'See the school calendar',
  'system.calendar.create':     'Add calendar events',
  'system.calendar.edit':       'Change calendar events',
  'system.calendar.delete':     'Delete calendar events',
  'system.calendar.export':     'Export the calendar to PDF',
  'system.settings.view':       'See the school settings',
  'system.settings.edit':       'Change the school settings',
  'system.users.view':          'See the users',
  'system.users.create':        'Add, invite and import users',
  'system.users.edit':          'Change users, their roles and their passwords',
  'system.users.deactivate':    'Deactivate and reactivate users',
  'system.users.export':        'Export the user list',
  'system.roles.view':          'See roles and permissions',
  'system.roles.edit':          'Change what a role may do',
  'system.audit.view':          'See the audit log',
  'system.audit.export':        'Export the audit log',
  'system.subscription.view':   'See the subscription and invoices',

  'students.list.view':         'View students',
  'students.import':            'Import students',
  'students.admissions.view':  'View admissions',
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

/** The grant that means every permission (given to Owner and Administrator). */
export const WILDCARD = '*';

export interface AccessUser {
  id: string;
  schoolId: string;
  /** The older single access level; the pages written before roles were data still use it. */
  role: UserRole;
  /** Modules switched off for the user's school. */
  disabledModules?: readonly string[];
  /** Permission keys granted by the person's roles (RolePermission rows), or "*" for everything. */
  grants?: readonly string[];
  /** The school is suspended, or this is a support session: looking is allowed, changing is not. */
  readOnly?: boolean;
  /** A support session: looking is allowed, but nothing may be exported (people's details stay on screen). */
  noExport?: boolean;
}

/** Narrows a check, e.g. to one school. A scope naming another school is never allowed. */
export interface AccessScope {
  schoolId?: string;
}

/** The actions that only look. Everything else changes something. */
const LOOKING = new Set(['view', 'export']);

export function can(user: AccessUser | null | undefined, permission: string, scope?: AccessScope): boolean {
  if (!user) return false;
  if (!(permission in PERMISSIONS)) return false; // a typo must never grant access
  if (scope?.schoolId !== undefined && scope.schoolId !== user.schoolId) return false;

  if (isSelfService(permission)) return true;

  const mod = moduleOf(permission);
  if (!ALWAYS_ON_MODULES.includes(mod) && user.disabledModules?.includes(mod)) return false;

  const action = permission.split('.').pop() ?? '';
  if (user.readOnly && !LOOKING.has(action)) return false;
  if (user.noExport && action === 'export') return false;

  const grants = user.grants ?? [];
  return grants.includes(WILDCARD) || grants.includes(permission);
}

/** Turns the rows that say which modules are on into the list of switched-off ones. */
export function disabledModulesFrom(rows: { module: string; enabled: boolean }[]): string[] {
  return rows.filter((r) => !r.enabled && !ALWAYS_ON_MODULES.includes(r.module)).map((r) => r.module);
}
