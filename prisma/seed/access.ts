// The one place that says which roles exist and what each may do (docs: "Pfuma Access Control", Exact permission grants per role).
//
//   * ROLES / BASE_GRANTS / LEGACY_ALIASES are the data. Grants are written as patterns ("finance.*", "students.*.view") and a
//     leading "-" takes keys back out; expandGrants() turns them into one scope per key.
//   * The permission catalogue is lib/access-core.ts PERMISSIONS, so a key exists in code and in the database from one list.
//   * accessSeedStatements() is that data as SQL. The migration (20261109000300_access_seed) is that SQL written to a file, and a test
//     fails when the file and this data disagree. Change a grant here, then run:
//         npx ts-node --project tsconfig.seed.json prisma/seed/write-access-migration.ts prisma/migrations/<new folder>
//     and add the folder to RETRYABLE in scripts/migrate-deploy.mjs.
//   * seedAccess(prisma) applies the same statements to a database, so a fresh dev database gets the roles too. It can be run any number
//     of times: a grant already in place is not touched, and nothing is bumped when nothing changed.
//
// New schools get all of this from the seed_school_roles() function that the SQL replaces (a trigger calls it when a school is added).
import { PERMISSIONS } from '../../lib/access-core';

export type Scope = 'SCHOOL' | 'DEPARTMENT' | 'CLASS' | 'ASSIGNED' | 'HOSTEL' | 'STORE' | 'RECORDED_BY_ME' | 'SELF';

// ─── The catalogue ───────────────────────────────────────────────────────────

export interface CatalogueKey { key: string; module: string; page: string; action: string; description: string; isSensitive: boolean }

/** Keys that are audited when read and when refused. Must stay in step with the rule in migration 20261109000200. */
export function isSensitiveKey(key: string): boolean {
  const action = key.split('.')[2];
  return key.startsWith('students.medical.') || key.startsWith('hr.pay.') || key.startsWith('hr.payroll.') || action === 'export'
    || ['students.guardians.view_ids', 'students.discipline.view', 'hr.discipline.view', 'finance.payments.void', 'finance.charges.void',
      'finance.expenses.void', 'finance.refunds.approve', 'system.roles.edit'].includes(key);
}

/** Every key of the catalogue except the self-service `account.*` ones, which everyone holds and which are not rows in the database. */
export function catalogue(): CatalogueKey[] {
  return Object.entries(PERMISSIONS)
    .filter(([key]) => !key.startsWith('account.'))
    .map(([key, description]) => {
      const [module, page, action] = key.split('.');
      return { key, module: module!, page: page!, action: action!, description, isSensitive: isSensitiveKey(key) };
    });
}

// ─── Roles ───────────────────────────────────────────────────────────────────

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  /** Scope of every grant that does not name its own ("key@SCOPE"). */
  scope: Scope;
  grants: string[];
  /** Custom-role templates only: the system role it was copied from. They are created once per school and then belong to the school. */
  copiedFrom?: string;
}

/**
 * Held by every staff user through every role. Self-service keys stay at SELF even when a role holds a wildcard such as "hr.*":
 * an HR officer sees everyone's records through hr.employees.view, never through hr.self.payslips.
 */
export const BASE_GRANTS: string[] = [
  'system.dashboard.view', 'system.calendar.view', 'academics.timetable.view@SELF', 'hr.duties.view@SELF', 'hr.self.payslips@SELF',
  'hr.self.leave@SELF', 'hr.self.details@SELF', 'hr.leave.request@SELF', 'hr.attendance.self@SELF', 'finance.requests.create@SELF', 'hr.directory.view',
];
export const SELF_ONLY_KEYS = ['hr.self.payslips', 'hr.self.leave', 'hr.self.details', 'hr.leave.request', 'hr.attendance.self', 'finance.requests.create'];

export const ROLES: RoleSeed[] = [
  {
    key: 'OWNER', name: 'Owner', description: 'Owns the school. Full access to everything.', scope: 'SCHOOL',
    grants: [
      '*.*.view', '*.*.export', 'system.subscription.view', 'system.roles.edit', 'system.users.*',
      'finance.payments.void', 'finance.charges.void', 'finance.expenses.void', 'finance.refunds.approve', 'finance.requests.approve',
      'system.terms.reopen', // not in the access document: reopening a closed term was the Director's alone
      'finance.settings.manage', // not in the access document: the money controls (limits, currencies) are the owner's, not the bursar's
      'hr.payroll.approve', 'hr.posts.approve', 'hr.pay.view', 'facilities.assets.dispose', 'students.medical.view', 'communication.broadcast.school',
    ],
  },
  {
    key: 'HEAD', name: 'Head', description: 'The head of the school. Oversees teaching, staff and finance.', scope: 'SCHOOL',
    grants: [
      'students.*.view', 'academics.*.view', 'exams.*.view',
      'students.admissions.approve', 'students.enrolment.approve', 'students.promotion.approve', 'students.discipline.approve', 'students.leavers.approve', 'students.medical.view',
      'academics.subjects.approve', 'academics.assignments.approve', 'academics.timetable.approve', 'academics.schemes.approve',
      'exams.marks.unlock', 'exams.results.publish', 'exams.results.unpublish', 'exams.comments.head', 'exams.zimsec.approve',
      'finance.dashboard.view', 'finance.reports.*', 'finance.statements.view', 'finance.fees.approve', 'finance.adjustments.approve', 'finance.awards.approve',
      'finance.plans.approve', 'finance.requests.approve', 'finance.cashup.signoff',
      'hr.employees.view', 'hr.leave.approve', 'hr.leave.view_all', 'hr.duties.approve', 'hr.posts.approve', 'hr.payroll.view', 'hr.discipline.view',
      'facilities.*.view', 'facilities.exeats.approve', 'facilities.inventory.writeoff', 'facilities.assets.dispose',
      'system.calendar.*', 'system.audit.view', 'communication.broadcast.school',
    ],
  },
  {
    key: 'DEPUTY_HEAD', name: 'Deputy Head', description: 'Supports the head and runs day-to-day discipline and timetabling.', scope: 'SCHOOL',
    grants: [
      'students.profiles.view', 'students.discipline.view', 'students.discipline.create',
      'academics.*', '-academics.*.approve',
      'exams.results.view', 'exams.timetable.approve', 'exams.analytics.view',
      'exams.marks.verify', // not in the access document: the Deputy is the alternate verifier when a Head of Department teaches the class, and only a holder of this key may verify
      'hr.attendance.view', 'hr.duties.manage', 'hr.leave.approve', 'system.calendar.*', 'communication.send.group',
    ],
  },
  {
    key: 'ADMINISTRATOR', name: 'Administrator', description: 'Runs the system for the school: users, settings, calendar and records.', scope: 'SCHOOL',
    grants: [
      'system.settings.*', 'system.users.*', 'system.roles.view', 'system.calendar.*', 'system.audit.view',
      'students.*', '-students.*.approve', '-students.medical.export',
      'academics.classes.manage', 'academics.subjects.manage', 'academics.student_subjects.manage', 'academics.assignments.manage',
      'communication.templates.manage',
    ],
  },
  {
    key: 'BURSAR', name: 'Bursar', description: 'Manages fees, payments, expenses and the school accounts.', scope: 'SCHOOL',
    grants: [
      'finance.*', '-finance.payments.void', '-finance.charges.void', '-finance.expenses.void', '-finance.refunds.approve', '-finance.requests.approve',
      '-finance.fees.approve', '-finance.adjustments.approve', '-finance.awards.approve', '-finance.plans.approve', '-finance.cashup.signoff', '-finance.settings.manage',
      'hr.payroll.view', 'hr.payroll.settings', // settings: not in the access document; the bursar confirms the tax tables and rates, so the person who prepares payroll does not
      'facilities.inventory.*', '-facilities.inventory.writeoff', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.verify',
      'facilities.transport.*', 'facilities.wallets.view', 'facilities.tuckshop.cashup', 'students.profiles.view', 'communication.reminders.send',
    ],
  },
  {
    key: 'ACCOUNTS_CLERK', name: 'Accounts Clerk', description: 'Records payments and keeps the daily accounts under the bursar.', scope: 'SCHOOL',
    grants: ['finance.payments.record@RECORDED_BY_ME', 'finance.cashup.submit@RECORDED_BY_ME', 'finance.statements.view', 'finance.rates.view', 'students.profiles.view'],
  },
  {
    key: 'HR_OFFICER', name: 'HR Officer', description: 'Looks after staff records, leave and payroll.', scope: 'SCHOOL',
    grants: ['hr.*', '-hr.payroll.approve', '-hr.posts.approve', '-hr.leave.approve', 'academics.assignments.view', 'communication.send.group'],
  },
  {
    key: 'HOD', name: 'Head of Department', description: 'Leads a subject department and its teachers.', scope: 'DEPARTMENT',
    grants: [
      'academics.assignments.view', 'academics.schemes.view', 'academics.schemes.approve', 'academics.syllabus.manage', 'academics.analytics.view',
      'exams.marks.verify', 'exams.results.view', 'exams.analytics.view', 'students.profiles.view', 'students.discipline.view', 'communication.send.group',
    ],
  },
  {
    key: 'TEACHER', name: 'Teacher', description: 'Teaches classes and enters marks for their subjects.', scope: 'ASSIGNED',
    grants: [
      'academics.assignments.view', 'academics.attendance.mark', 'academics.schemes.edit',
      'exams.assessments.create', 'exams.marks.enter', 'exams.marks.submit', 'exams.comments.subject', 'exams.analytics.view',
      'students.profiles.view', 'students.discipline.create',
    ],
  },
  {
    key: 'CLASS_TEACHER', name: 'Class Teacher', description: 'Looks after one class: register, remarks and report cards.', scope: 'CLASS',
    grants: [
      // attendance.view is not in the access document; the class teacher's summary of their own class needs it (a subject teacher does not).
      'academics.attendance.mark', 'academics.attendance.view', 'students.profiles.view', 'students.guardians.view', 'students.discipline.create', 'students.discipline.view',
      'exams.comments.class', 'exams.results.view', 'finance.arrears.flag', 'facilities.hostel.view', 'communication.send.group',
      // exams.analytics.view is not in the access document; the class teacher's trend and at-risk panels for their own class need it.
      'exams.analytics.view',
    ],
  },
  {
    key: 'EXAMS_OFFICER', name: 'Exams Officer', description: 'Runs internal and ZIMSEC examinations and their results.', scope: 'SCHOOL',
    grants: [
      'exams.setup.manage', 'exams.projects.manage', 'exams.timetable.manage', 'exams.invigilation.manage', 'exams.zimsec.manage', 'exams.zimsec.results_import',
      'exams.results.view', 'exams.analytics.view', 'students.profiles.view', 'communication.send.group',
    ],
  },
  {
    key: 'LIBRARIAN', name: 'Librarian', description: 'Runs the library: books, borrowing and fines.', scope: 'SCHOOL',
    grants: ['facilities.library.*', 'facilities.textbooks.issue', 'students.profiles.view'],
  },
  {
    key: 'BOARDING_MASTER', name: 'Boarding Master', description: 'Looks after the boarding hostels and the boarders.', scope: 'HOSTEL',
    grants: [
      'facilities.hostel.*', 'facilities.exeats.request', 'facilities.exeats.signout', 'facilities.visitors.log', 'facilities.wallets.manage', 'facilities.tuckshop.*',
      'facilities.sickbay.view', 'students.profiles.view', 'students.guardians.view', 'students.discipline.create', 'communication.send.group',
    ],
  },
  {
    key: 'MATRON', name: 'Matron', description: 'Looks after the sick bay and the medical notes of the boarders in her hostel.', scope: 'HOSTEL',
    grants: ['facilities.sickbay.*', 'facilities.hostel.rollcall', 'students.medical.view', 'students.medical.edit', 'facilities.inventory.issue@STORE'],
  },
  // Templates a school can use as they are or change: created once per school as custom roles, never reset by a later run.
  { key: 'STOREKEEPER', name: 'Storekeeper', description: 'Keeps one store: receives, issues and counts stock.', scope: 'STORE', copiedFrom: 'BURSAR',
    grants: ['facilities.inventory.view', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count'] },
  { key: 'TRANSPORT_OFFICER', name: 'Transport Officer', description: 'Runs routes, vehicles, trips and learner transport.', scope: 'SCHOOL', copiedFrom: 'BURSAR',
    grants: ['facilities.transport.*'] },
  { key: 'TUCKSHOP_ATTENDANT', name: 'Tuck Shop Attendant', description: 'Sells at the tuck shop.', scope: 'HOSTEL', copiedFrom: 'BOARDING_MASTER',
    grants: ['facilities.tuckshop.sell'] },
  { key: 'NURSE', name: 'Nurse', description: 'The Matron\'s sick bay and medical access for the whole school.', scope: 'SCHOOL', copiedFrom: 'MATRON',
    grants: ['facilities.sickbay.*', 'facilities.hostel.rollcall', 'students.medical.view', 'students.medical.edit', 'facilities.inventory.issue@STORE'] },
];

/** The roles that are system roles (not templates). */
export const SYSTEM_ROLE_KEYS = ROLES.filter((r) => !r.copiedFrom).map((r) => r.key);

/**
 * Roles that still hold "*" while the rest of the switch is under way (docs: Moving from "admin sees everything"). Step 8 empties this and
 * adds a migration that removes the "*" rows.
 */
export const TRANSITIONAL_WILDCARD: string[] = [];

/**
 * Keys the first pages were written with, which are not in the access document. A role holding any anchor key also holds the legacy key at
 * the same scope (the widest of the anchors), so the pages that still check it keep working without widening anyone's access.
 */
export const LEGACY_ALIASES: Record<string, string[]> = {
  'students.list.view': ['students.profiles.view'],
  'students.attendance.view': ['academics.attendance.view'],
  'students.promotions.view': ['students.promotion.manage', 'students.promotion.approve'],
  'exams.marks.view': ['exams.results.view'],
  'exams.reports.view': ['exams.results.view'],
  'exams.grading.view': ['exams.results.view', 'exams.setup.manage'],
  'finance.fees.view': ['finance.fees.manage', 'finance.fees.approve', 'finance.statements.view'],
  'finance.payments.view': ['finance.payments.record', 'finance.payments.verify', 'finance.payments.void'],
  'finance.expenses.view': ['finance.expenses.manage', 'finance.expenses.void', 'finance.reports.view'],
  'finance.requests.view': ['finance.requests.approve', 'finance.requests.disburse'],
  'finance.accounts.view': ['finance.statements.view', 'finance.charges.create', 'finance.payments.record'],
  'hr.staff.view': ['hr.employees.view'],
  'hr.leave.view': ['hr.leave.view_all', 'hr.leave.approve'],
  'communication.announcements.view': ['communication.send.group', 'communication.broadcast.school'],
  'communication.messages.view': ['communication.broadcast.school', 'communication.templates.manage', 'communication.reminders.send'],
  'communication.portal.view': ['communication.broadcast.school', 'communication.templates.manage'],
  // Last, so the keys above do not follow them. The Academics pages open on these for a teacher and a class teacher (the code narrows them to the classes they teach or look after).
  // Not a general "edit brings view" rule: students.discipline.create must NOT bring students.discipline.view.
  'academics.classes.view': ['academics.attendance.mark'],
  'academics.subjects.view': ['academics.schemes.edit', 'academics.attendance.mark'],
  'academics.schemes.view': ['academics.schemes.edit'],
};

// ─── Turning patterns into keys ──────────────────────────────────────────────

/** Narrowest last. Where one role names a key twice, the widest wins. */
const WIDTH: Record<Scope, number> = { SCHOOL: 0, DEPARTMENT: 1, CLASS: 2, ASSIGNED: 2, HOSTEL: 2, STORE: 2, RECORDED_BY_ME: 3, SELF: 4 };
const SCOPES = Object.keys(WIDTH) as Scope[];

function matches(pattern: string, key: string): boolean {
  const p = pattern.split('.');
  while (p.length < 3) p.push('*');
  const k = key.split('.');
  return p.every((part, i) => part === '*' || part === k[i]);
}

function parse(item: string, fallback: Scope): { negate: boolean; pattern: string; scope: Scope } {
  const negate = item.startsWith('-');
  const [pattern, scope] = (negate ? item.slice(1) : item).split('@');
  if (scope && !SCOPES.includes(scope as Scope)) throw new Error(`Unknown scope in "${item}"`);
  return { negate, pattern: pattern!, scope: (scope as Scope | undefined) ?? fallback };
}

/** The keys a role holds and at which scope: base grants, then the role's own, then the legacy aliases. */
export function expandGrants(role: RoleSeed, keys: readonly string[] = catalogue().map((c) => c.key)): Map<string, Scope> {
  const held = new Map<string, Scope>();
  const give = (key: string, scope: Scope) => {
    const now = held.get(key);
    if (!now || WIDTH[scope] < WIDTH[now]) held.set(key, scope);
  };
  for (const item of BASE_GRANTS) {
    const g = parse(item, 'SCHOOL');
    const hits = keys.filter((k) => matches(g.pattern, k));
    if (!hits.length) throw new Error(`Base grant "${item}" matches no key`);
    for (const k of hits) give(k, g.scope);
  }
  for (const item of role.grants) {
    const g = parse(item, role.scope);
    const hits = keys.filter((k) => matches(g.pattern, k));
    if (!hits.length) throw new Error(`${role.key}: "${item}" matches no key`);
    if (g.negate) { for (const k of hits) held.delete(k); continue; }
    const wild = g.pattern.includes('*');
    for (const k of hits) if (!(wild && SELF_ONLY_KEYS.includes(k))) give(k, g.scope);
  }
  for (const [legacy, anchors] of Object.entries(LEGACY_ALIASES)) {
    if (held.has(legacy)) continue;
    const scopes = anchors.map((a) => held.get(a)).filter((s): s is Scope => !!s);
    if (scopes.length) held.set(legacy, scopes.sort((a, b) => WIDTH[a] - WIDTH[b])[0]!);
  }
  return held;
}

/** Every (role, key, scope) the database should hold, including the temporary "*" rows. */
export function grantRows(): { role: string; key: string; scope: Scope }[] {
  const keys = catalogue().map((c) => c.key);
  const rows: { role: string; key: string; scope: Scope }[] = [];
  for (const role of ROLES) {
    for (const [key, scope] of Array.from(expandGrants(role, keys)).sort(([a], [b]) => a.localeCompare(b))) rows.push({ role: role.key, key, scope });
    if (TRANSITIONAL_WILDCARD.includes(role.key)) rows.push({ role: role.key, key: '*', scope: 'SCHOOL' });
  }
  return rows;
}

// ─── The SQL ─────────────────────────────────────────────────────────────────

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The statements that bring a database to this data. Safe to run again. */
export function accessSeedStatements(): string[] {
  const cat = catalogue();
  const permissions = `INSERT INTO "Permission" ("key", "module", "page", "action", "description", "isSensitive") VALUES\n${cat
    .map((c) => `  (${q(c.key)}, ${q(c.module)}, ${q(c.page)}, ${q(c.action)}, ${q(c.description)}, ${c.isSensitive})`).join(',\n')}\n` +
    `ON CONFLICT ("key") DO UPDATE SET "isSensitive" = EXCLUDED."isSensitive"`;

  const roles = `CREATE OR REPLACE FUNCTION access_roles() RETURNS TABLE (role_key text, role_name text, role_description text, is_system boolean, copied_from text)\n` +
    `LANGUAGE sql IMMUTABLE AS $$\n  SELECT * FROM (VALUES\n${ROLES.map((r) => `    (${q(r.key)}, ${q(r.name)}, ${q(r.description)}, ${r.copiedFrom ? 'false' : 'true'}, ${r.copiedFrom ? q(r.copiedFrom) : 'NULL::text'})`).join(',\n')}\n  ) AS v(role_key, role_name, role_description, is_system, copied_from)\n$$`;

  const grants = `CREATE OR REPLACE FUNCTION access_grants() RETURNS TABLE (role_key text, permission_key text, scope "AccessScope")\n` +
    `LANGUAGE sql IMMUTABLE AS $$\n  SELECT v.r, v.k, v.s::"AccessScope" FROM (VALUES\n${grantRows().map((g) => `    (${q(g.role)}, ${q(g.key)}, ${q(g.scope)})`).join(',\n')}\n  ) AS v(r, k, s)\n$$`;

  const seed = `CREATE OR REPLACE FUNCTION seed_school_roles(sid text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  changed integer := 0;
  tpl record;
BEGIN
  -- The system roles: name and description follow this data.
  INSERT INTO "RoleDefinition" ("id", "schoolId", "key", "name", "description", "isSystem", "updatedAt")
  SELECT gen_random_uuid()::text, sid, r.role_key, r.role_name, r.role_description, true, CURRENT_TIMESTAMP
    FROM access_roles() r WHERE r.is_system
  ON CONFLICT ("schoolId", "key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "RoleDefinition"."isSystem" AND ("RoleDefinition"."name", "RoleDefinition"."description") IS DISTINCT FROM (EXCLUDED."name", EXCLUDED."description");

  -- Their grants become exactly this data: a missing one is added, a different scope is corrected, one that is not listed is taken away.
  INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "scope", "updatedAt")
  SELECT gen_random_uuid()::text, sid, rd."id", g.permission_key, g.scope, CURRENT_TIMESTAMP
    FROM access_grants() g JOIN "RoleDefinition" rd ON rd."schoolId" = sid AND rd."key" = g.role_key AND rd."isSystem"
  ON CONFLICT ("roleId", "permissionKey") DO UPDATE SET "scope" = EXCLUDED."scope", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "RolePermission"."scope" IS DISTINCT FROM EXCLUDED."scope";
  GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;

  DELETE FROM "RolePermission" rp USING "RoleDefinition" rd
   WHERE rp."roleId" = rd."id" AND rd."schoolId" = sid AND rd."isSystem" AND rd."key" IN (SELECT r.role_key FROM access_roles() r WHERE r.is_system)
     AND NOT EXISTS (SELECT 1 FROM access_grants() g WHERE g.role_key = rd."key" AND g.permission_key = rp."permissionKey");
  GET DIAGNOSTICS n = ROW_COUNT; changed := changed + n;

  -- The templates: made once, as the school's own custom roles, copied from the system role they are a part of.
  FOR tpl IN SELECT * FROM access_roles() r WHERE NOT r.is_system LOOP
    IF NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE "schoolId" = sid AND "key" = tpl.role_key) THEN
      INSERT INTO "RoleDefinition" ("id", "schoolId", "key", "name", "description", "isSystem", "copiedFromRoleId", "updatedAt")
      SELECT gen_random_uuid()::text, sid, tpl.role_key, tpl.role_name, tpl.role_description, false,
             (SELECT src."id" FROM "RoleDefinition" src WHERE src."schoolId" = sid AND src."key" = tpl.copied_from), CURRENT_TIMESTAMP;
      INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey", "scope", "updatedAt")
      SELECT gen_random_uuid()::text, sid, rd."id", g.permission_key, g.scope, CURRENT_TIMESTAMP
        FROM access_grants() g JOIN "RoleDefinition" rd ON rd."schoolId" = sid AND rd."key" = g.role_key
       WHERE g.role_key = tpl.role_key;
    END IF;
  END LOOP;

  -- Anyone holding a role whose grants moved picks the change up within a minute.
  IF changed > 0 THEN
    UPDATE "User" u SET "permVersion" = u."permVersion" + 1
     WHERE u."schoolId" = sid AND EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id");
  END IF;
END;
$$`;
  return [permissions, roles, grants, seed];
}

/** The text of the migration: the statements, then one run for every school that exists. */
export function accessMigrationSql(): string {
  return `-- Access control, step 3: the roles and the exact grants of each, from prisma/seed/access.ts. Generated: do not edit by hand; change the
-- data there and write this file again (see the top of that file). Running it again changes nothing.
--   * every key of the catalogue is a Permission row (the Communication placeholders and facilities.transport.view are new) and
--     isSensitive follows the rule;
--   * a Matron role, and four templates (Storekeeper, Transport Officer, Tuck Shop Attendant, Nurse) made once as custom roles;
--   * the 14 system roles hold exactly these grants, each at its scope. Grants a role held before and the new list does not name are
--     taken away; Owner and Administrator keep "*" until the switch (step 8);
--   * seed_school_roles() is replaced, so a school added later starts the same way.
-- Nobody gets a different role: only what each role may do is brought to the list.

${accessSeedStatements().join(';\n\n')};

SELECT seed_school_roles("id") FROM "School";
`;
}

// ─── Running it ──────────────────────────────────────────────────────────────

interface RawDb { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe(sql: string): Promise<unknown> }

/** Applies the data to a database (every school in it). For a fresh dev database; production gets the migration. */
export async function seedAccess(db: RawDb): Promise<void> {
  for (const statement of accessSeedStatements()) await db.$executeRawUnsafe(statement);
  await db.$queryRawUnsafe('SELECT seed_school_roles("id") FROM "School"');
}
