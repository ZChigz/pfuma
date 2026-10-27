// The permission check, with no database or framework imports so tests, server
// code and client code can all share it. lib/access.ts adds the server helpers
// (requirePermission, getAccess) and re-exports everything here.
//
// Pages, menu items, buttons and API routes ask `can(user, 'system.users.create')`;
// they never look at a role name. Who holds which permission is decided here and
// in the RolePermission table, so a new access level is a data change.
import type { UserRole } from '@/types';
import type { EffectivePermissions } from '@/lib/access/types';

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

// Facilities & Operations has eight parts, each switched on or off for a school on its own. A part is a SchoolModule row whose
// module is 'facilities.<part>'; no row means on. Switching the whole of Facilities off hides every part.
export const FACILITY_PARTS = [
  { key: 'hostel',    label: 'Hostel' },
  { key: 'exeats',    label: 'Exeats and visiting days' },
  { key: 'sickbay',   label: 'Sick bay' },
  { key: 'tuckshop',  label: 'Tuck shop and pocket money' },
  { key: 'library',   label: 'Library and textbooks' },
  { key: 'transport', label: 'Transport' },
  { key: 'inventory', label: 'Inventory and stores' },
  { key: 'assets',    label: 'Assets and maintenance' },
] as const;
export type FacilityPart = (typeof FACILITY_PARTS)[number]['key'];
export const facilityModuleKey = (part: FacilityPart) => `facilities.${part}`;
export const FACILITY_PART_KEYS: readonly string[] = FACILITY_PARTS.map((p) => facilityModuleKey(p.key));

export const MODULE_KEYS: readonly string[] = [...MODULES.map((m) => m.key), ...FACILITY_PART_KEYS];

/** Every switch the platform console shows: the modules, then the parts of Facilities under it. */
export const MODULE_SWITCHES: readonly { key: string; label: string }[] = [
  ...MODULES.flatMap((m) => [m, ...(m.key === 'facilities' ? FACILITY_PARTS.map((p) => ({ key: facilityModuleKey(p.key), label: `${m.label}: ${p.label}` })) : [])]),
];

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
  'system.terms.reopen':        'Reopen a closed term',

  // Student Information: the same keys are rows in the Permission table (migration 20261031000000).
  // Owner and Administrator hold them through '*'; other roles are given them in System, Roles.
  'students.list.view':         'View students',
  'students.attendance.view':   'View attendance',
  'students.promotions.view':   'View promotions',
  'students.profiles.view':     'See student profiles',
  'students.profiles.create':   'Add students',
  'students.profiles.edit':     'Change student details, move classes',
  'students.profiles.export':   'Export student lists',
  'students.profiles.import':   'Import students from a file',
  'students.guardians.view':    'See guardians',
  'students.guardians.edit':    'Add, link and change guardians',
  'students.guardians.view_ids':'See guardian ID numbers',
  'students.admissions.view':   'See admissions',
  'students.admissions.manage': 'Manage intakes and applicants',
  'students.admissions.approve':'Approve offers',
  'students.enrolment.view':    'See class history',
  'students.enrolment.manage':  'Move students between classes',
  'students.enrolment.approve': 'Approve class moves after the term has started',
  'students.promotion.manage':  'Prepare the year-end promotion',
  'students.promotion.approve': 'Approve the year-end promotion',
  'students.documents.view':    'See student documents',
  'students.documents.upload':  'Upload student documents',
  'students.documents.generate':'Generate letters and certificates',
  'students.discipline.view':   'See discipline records',
  'students.discipline.create': 'Record incidents',
  'students.discipline.approve':'Approve suspensions, decide on expulsions',
  'students.medical.view':      'See medical details',
  'students.medical.edit':      'Change medical details',
  'students.medical.export':    'Include medical details in exports',
  'students.leavers.manage':    'Start the leaving process',
  'students.leavers.approve':   'Approve leavings',
  'students.alumni.view':       'See alumni',
  'students.alumni.export':     'Export alumni contact lists',

  // Academics: the same keys are rows in the Permission table (migration 20261101000000). Owner and Administrator hold
  // them through '*'; a teacher and a class teacher hold the own-class keys, which the code narrows to their classes.
  'academics.classes.view':     'View classes and streams',
  'academics.classes.manage':   'Assign class teachers, copy classes from the last term',
  'academics.subjects.view':    'View subjects',
  'academics.subjects.manage':  'Change departments, subjects and combinations',
  'academics.subjects.approve': 'Approve changes to the subject list',
  'academics.student_subjects.manage': 'Give students their subjects',
  'academics.assignments.view': 'View teacher assignments and workload',
  'academics.assignments.manage': 'Assign teachers to classes and subjects',
  'academics.assignments.approve': 'Approve the term\'s teacher assignments',
  'academics.attendance.mark':  'Mark attendance registers',
  'academics.attendance.view':  'View attendance registers and summaries',
  'academics.attendance.correct': 'Correct registers older than 7 days',
  'academics.timetable.view':   'View the timetable',
  'academics.timetable.edit':   'Build the timetable and the bell schedule',
  'academics.timetable.approve': 'Approve and publish the timetable',
  'academics.timetable.cover':  'Assign cover lessons',
  'academics.schemes.edit':     'Write schemes of work and records of work',
  'academics.schemes.approve':  'Approve schemes of work',
  'academics.schemes.view':     'View schemes and records of work',
  'academics.syllabus.manage':  'Manage the syllabus topics',
  'academics.analytics.view':   'View academic analytics',

  // Examinations: the same keys are rows in the Permission table (migration 20261102000000). Owner and Administrator hold them
  // through '*'; teachers, HODs, the Head and the Exams Officer hold the scoped keys, which the code narrows to their own
  // assignments, department or class.
  'exams.marks.view':           'View mark entry',
  'exams.results.view':         'View results',
  'exams.reports.view':         'View report cards',
  'exams.grading.view':         'View grade boundaries',
  'exams.setup.manage':         'Set the assessment types, weighting plans and end-of-term exams',
  'exams.projects.manage':      'Manage school-based project templates',
  'exams.assessments.create':   'Create tests and assignments for own classes',
  'exams.marks.enter':          'Enter marks for own classes',
  'exams.marks.submit':         'Submit own mark sheets for verification',
  'exams.marks.verify':         'Verify or return the mark sheets of own department',
  'exams.marks.unlock':         'Unlock verified mark sheets, excuse absences',
  'exams.comments.subject':     'Write subject comments for own classes',
  'exams.comments.class':       'Write class teacher comments for own class',
  'exams.comments.head':        'Write the Head\'s remarks',
  'exams.results.publish':      'Publish results and report cards',
  'exams.results.unpublish':    'Unpublish results for a correction',
  'exams.reportcards.settings': 'Change the report card settings',
  'exams.timetable.manage':     'Schedule exam periods and papers',
  'exams.timetable.approve':    'Approve the exam timetable',
  'exams.invigilation.manage':  'Assign invigilators and seating',
  'exams.zimsec.manage':        'Manage ZIMSEC and Cambridge entries',
  'exams.zimsec.approve':       'Approve the entry list',
  'exams.zimsec.results_import': 'Load released board results',
  'exams.analytics.view':       'View examination analytics',

  // Finance: the same keys are rows in the Permission table (migration 20261103000000). Owner and Administrator hold them through '*'
  // but the separation of duties still applies to them: whoever records money cannot verify it, whoever asks for spending cannot
  // approve or pay it.
  'finance.fees.view':          'View fees',
  'finance.payments.view':      'View payments',
  'finance.expenses.view':      'View expenses',
  'finance.requests.view':      'View expense requests',
  'finance.rates.view':         'View exchange rates',
  'finance.reports.view':       'View finance reports',
  'finance.accounts.view':      'See student accounts and statements',
  'finance.funds.manage':       'Add and change funds',
  'finance.fees.manage':        'Set the fees of a term',
  'finance.charges.create':     'Charge fees to students',
  'finance.charges.void':       'Void a charge made in error',
  'finance.payments.record':    'Record payments received',
  'finance.payments.verify':    'Verify or reject payments recorded by someone else',
  'finance.payments.void':      'Void a payment',
  'finance.adjustments.create': 'Ask for a credit note, discount, bursary or waiver',
  'finance.adjustments.approve':'Approve or reject credit notes and discounts',
  'finance.refunds.request':    'Ask for a refund',
  'finance.refunds.approve':    'Approve or reject refunds',
  'finance.refunds.pay':        'Pay out an approved refund',
  'finance.requests.create':    'Raise expense requests',
  'finance.requests.approve':   'Approve or reject expense requests',
  'finance.requests.disburse':  'Pay out an approved expense request',
  'finance.expenses.record':    'Record a direct expense',
  'finance.expenses.void':      'Void an expense',
  'finance.settings.manage':    'Change the money controls',
  'finance.reports.export':     'Export finance reports',
  'finance.dashboard.view':     'See the finance dashboard',
  'finance.fees.approve':       'Approve a term\'s fee structure',
  'finance.billing.run':        'Run term billing',
  'finance.sponsors.manage':    'Manage sponsors and their awards',
  'finance.awards.approve':     'Approve sponsor awards',
  'finance.payments.allocate':  'Change how a payment is allocated',
  'finance.credit.transfer':    'Move credit to a brother or sister',
  'finance.statements.view':    'See statements and the finance tab of a student',
  'finance.arrears.flag':       'See the small fees-outstanding marker for the own class',
  'finance.plans.manage':       'Record payment plans',
  'finance.plans.approve':      'Approve payment plans longer than a term',
  'finance.expenses.manage':    'Manage expenses, categories and petty cash',
  'finance.suppliers.manage':   'Manage suppliers',
  'finance.budgets.manage':     'Set budgets',
  'finance.rates.manage':       'Set exchange rates',
  'finance.cashup.submit':      'Submit the daily cash-up',
  'finance.cashup.confirm':     'Confirm cash-ups and bank the cash',
  'finance.cashup.signoff':     'Sign off the day',
  'finance.bank.reconcile':     'Reconcile bank statements',
  'finance.payroll.pay':        'Pay approved payroll runs',

  'hr.staff.view':              'View staff records',
  'hr.leave.view':              'View leave',
  'hr.payroll.view':            'View payroll',

  // HR & Staff: the same keys are rows in the Permission table (migration 20261105000100). Owner and Administrator hold them through '*',
  // but salary, bank details, ID numbers and medical notes are shown only to HR, the Owner and the employee themselves (lib/hr/common.ts).
  'hr.directory.view':          'See the staff directory (names, titles, departments, work phone)',
  'hr.employees.view':          'See full staff records',
  'hr.employees.manage':        'Add and change staff records',
  'hr.pay.view':                'See salaries, bank details, ID numbers and medical notes',
  'hr.pay.manage':              'Change pay set-up',
  'hr.posts.manage':            'Ask for new posts',
  'hr.posts.approve':           'Approve new posts',
  'hr.recruitment.manage':      'Run vacancies and applicants',
  'hr.contracts.manage':        'Manage contracts and end employment',
  'hr.attendance.mark':         'Mark the staff register',
  'hr.attendance.view':         'See staff attendance',
  'hr.attendance.correct':      'Correct staff attendance after the day',
  'hr.attendance.self':         'Sign myself in',
  'hr.leave.request':           'Request my own leave',
  'hr.leave.approve':           'Approve or reject leave',
  'hr.leave.view_all':          'See every leave request and balance',
  'hr.leave.adjust':            'Adjust leave balances',
  'hr.duties.manage':           'Build the duty roster',
  'hr.duties.approve':          'Approve and publish the duty roster',
  'hr.duties.view':             'See the duty roster',
  'hr.payroll.prepare':         'Prepare and submit payroll runs',
  'hr.payroll.approve':         'Approve payroll runs',
  'hr.payroll.settings':        'Change tax tables and statutory rates',
  'hr.documents.manage':        'Generate letters and keep staff documents',
  'hr.discipline.manage':       'Record staff disciplinary cases',
  'hr.discipline.view':         'See staff disciplinary records',
  'hr.self.payslips':           'See my own payslips',
  'hr.self.leave':              'See my own leave',
  'hr.self.details':            'See my own details and duties',
  'hr.reports.view':            'See HR reports',

  // Facilities & Operations: the same keys are rows in the Permission table (migration 20261106000000). Owner and Administrator hold
  // them through '*'; scoped roles (boarding master, matron, librarian, storekeeper, transport officer) are given keys in System, Roles.
  'facilities.assets.view':     'View assets',
  'facilities.library.view':    'View the library',
  'facilities.inventory.view':  'View inventory',
  'facilities.hostel.view':        'See the hostels, rooms, beds and roll calls',
  'facilities.hostel.manage':      'Set up hostels, rooms and beds',
  'facilities.hostel.allocate':    'Give learners beds and move them',
  'facilities.hostel.rollcall':    'Take the hostel roll call',
  'facilities.hostel.inspect':     'Inspect rooms',
  'facilities.exeats.request':     'Record exeat requests',
  'facilities.exeats.approve':     'Approve long and emergency exeats',
  'facilities.exeats.signout':     'Sign learners out and in at the gate or hostel office',
  'facilities.visitors.log':       'Keep the visitor log',
  'facilities.sickbay.record':     'Record sick bay visits and medication',
  'facilities.sickbay.view':       'See sick bay visit details',
  'facilities.wallets.manage':     'Take pocket money deposits and handle wallets',
  'facilities.wallets.view':       'See pocket money wallets',
  'facilities.tuckshop.sell':      'Sell at the tuck shop',
  'facilities.tuckshop.cashup':    'Cash up the tuck shop',
  'facilities.library.manage':     'Run the catalogue, members and library settings',
  'facilities.library.desk':       'Lend and take back books at the desk',
  'facilities.library.waive':      'Waive library fines',
  'facilities.textbooks.issue':    'Issue and collect textbooks',
  'facilities.transport.view':     'See routes, vehicles and trips',
  'facilities.transport.manage':   'Manage routes, vehicles, drivers and bookings',
  'facilities.transport.trips':    'Record daily trips and fuel',
  'facilities.transport.assign':   'Put learners on a route',
  'facilities.inventory.manage':   'Set up stores and stock items',
  'facilities.inventory.receive':  'Receive goods into stores',
  'facilities.inventory.issue':    'Issue, sell and transfer stock',
  'facilities.inventory.count':    'Count stock',
  'facilities.inventory.writeoff': 'Approve stock write-offs and count adjustments',
  'facilities.assets.manage':      'Keep the asset register',
  'facilities.assets.maintain':    'Assign and record maintenance',
  'facilities.assets.dispose':     'Approve the disposal of assets',
  'facilities.assets.verify':      'Run the annual asset verification',

  'communication.announcements.view': 'View announcements',
  'communication.messages.view':      'View SMS and WhatsApp messages',
  'communication.portal.view':        'View the parent portal',
  // Placeholders until the Communication module is built (migration 20261109000300).
  'communication.broadcast.school': 'Send a message to the whole school',
  'communication.send.group':       'Send a message to a group (staff, boarders, candidates, own class)',
  'communication.reminders.send':    'Send fee reminders',
  'communication.templates.manage':  'Manage message templates',
  'communication.log.view':          'See the message log',

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

/** The part of Facilities & Operations a permission belongs to (null for every other permission). */
export function facilityPartOf(permission: string): FacilityPart | null {
  const [mod, area] = permission.split('.');
  if (mod !== 'facilities') return null;
  switch (area) {
    case 'hostel': return 'hostel';
    case 'exeats': case 'visitors': return 'exeats';
    case 'sickbay': return 'sickbay';
    case 'wallets': case 'tuckshop': return 'tuckshop';
    case 'library': case 'textbooks': return 'library';
    case 'transport': return 'transport';
    case 'inventory': return 'inventory';
    case 'assets': return 'assets';
    default: return null;
  }
}

const isSelfService = (permission: string) => moduleOf(permission) === 'account';

// ─── can() ───────────────────────────────────────────────────────────────────

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
  /** A Pfuma support person looking at this school (read-only). */
  support?: boolean;
  /** How each key is held (at which scope), with the exceptions applied: lib/access/effective.ts. Server side only. */
  effective?: EffectivePermissions;
  /** Keys refused outright by a DENY exception. They beat every grant, "*" included. */
  denied?: readonly string[];
  /** Moves whenever the person's roles, exceptions or status change, or the grants of a role they hold (User.permVersion). */
  permVersion?: number;
  /** Days last term's records stay readable to a teacher after the term changes (School.previousTermReadDays). */
  previousTermReadDays?: number;
}

/** Narrows a check, e.g. to one school. A scope naming another school is never allowed. */
export interface AccessScope {
  schoolId?: string;
}

/** The actions that only look. Everything else changes something. */
const LOOKING = new Set(['view', 'export']);

/**
 * True when the person holds `permission` for the whole school, not only for their own classes, hostel, department or records.
 * Lists that narrow to "what is mine" for a narrower grant ask this instead of looking at a role name.
 */
export function schoolWide(user: AccessUser | null | undefined, permission: string): boolean {
  if (!can(user, permission)) return false;
  const eff = user!.effective;
  if (!eff) return true; // a bare list of keys has always meant school-wide
  const own = eff.grants.get(permission);
  return !!own && own.some((g) => g.scope === 'SCHOOL' && !g.scopeId);
}

/** True when the person holds `permission` at `scope` (a bare list of keys counts as school-wide). */
export function heldAt(user: AccessUser | null | undefined, permission: string, scope: string): boolean {
  if (!can(user, permission)) return false;
  const eff = user!.effective;
  if (!eff) return scope === 'SCHOOL';
  const own = eff.grants.get(permission);
  return !!own && own.some((g) => g.scope === scope);
}

export function can(user: AccessUser | null | undefined, permission: string, scope?: AccessScope): boolean {
  if (!user) return false;
  if (!(permission in PERMISSIONS)) return false; // a typo must never grant access
  if (scope?.schoolId !== undefined && scope.schoolId !== user.schoolId) return false;

  if (isSelfService(permission)) return true;

  const mod = moduleOf(permission);
  if (!ALWAYS_ON_MODULES.includes(mod) && user.disabledModules?.includes(mod)) return false;
  const part = facilityPartOf(permission);
  if (part && user.disabledModules?.includes(facilityModuleKey(part))) return false;

  const action = permission.split('.').pop() ?? '';
  if (user.readOnly && !LOOKING.has(action)) return false;
  if (user.noExport && action === 'export') return false;

  if (user.denied?.includes(permission)) return false;
  const grants = user.grants ?? [];
  return grants.includes(permission);
}

/** Turns the rows that say which modules are on into the list of switched-off ones. */
export function disabledModulesFrom(rows: { module: string; enabled: boolean }[]): string[] {
  return rows.filter((r) => !r.enabled && !ALWAYS_ON_MODULES.includes(r.module)).map((r) => r.module);
}
