// The 14 system roles every school has (created in the database for each school: see
// prisma/migrations/20261030000000_roles_audit_platform), and the access level that goes with each
// for the pages written before roles were data. A person with several roles gets the highest level.
import type { UserRole } from '@/types';

export const STAFF_ROLES = [
  { key: 'OWNER',           label: 'Owner',              access: 'DIRECTOR',  description: 'Owns the school. Full access to everything.' },
  { key: 'HEAD',            label: 'Head',               access: 'HEAD',      description: 'The head of the school. Oversees teaching, staff and finance.' },
  { key: 'DEPUTY_HEAD',     label: 'Deputy Head',        access: 'HEAD',      description: 'Supports the head and runs day-to-day discipline and timetabling.' },
  { key: 'ADMINISTRATOR',   label: 'Administrator',      access: 'ADMIN',     description: 'Runs the system for the school: users, settings, calendar and records.' },
  { key: 'BURSAR',          label: 'Bursar',             access: 'BURSAR',    description: 'Manages fees, payments, expenses and the school accounts.' },
  { key: 'ACCOUNTS_CLERK',  label: 'Accounts Clerk',     access: 'BURSAR',    description: 'Records payments and keeps the daily accounts under the bursar.' },
  { key: 'HR_OFFICER',      label: 'HR Officer',         access: 'TEACHER',   description: 'Looks after staff records, leave and payroll.' },
  { key: 'HOD',             label: 'Head of Department', access: 'TEACHER',   description: 'Leads a subject department and its teachers.' },
  { key: 'TEACHER',         label: 'Teacher',            access: 'TEACHER',   description: 'Teaches classes and enters marks for their subjects.' },
  { key: 'CLASS_TEACHER',   label: 'Class Teacher',      access: 'TEACHER',   description: 'Looks after one class: register, remarks and report cards.' },
  { key: 'EXAMS_OFFICER',   label: 'Exams Officer',      access: 'TEACHER',   description: 'Runs internal and ZIMSEC examinations and their results.' },
  { key: 'LIBRARIAN',       label: 'Librarian',          access: 'LIBRARIAN', description: 'Runs the library: books, borrowing and fines.' },
  { key: 'BOARDING_MASTER', label: 'Boarding Master',    access: 'TEACHER',   description: 'Looks after the boarding hostels and the boarders.' },
  { key: 'MATRON',          label: 'Matron',             access: 'TEACHER',   description: 'Looks after the sick bay and the medical notes of the boarders.' },
] as const satisfies readonly { key: string; label: string; access: UserRole; description: string }[];

export type StaffRoleKey = (typeof STAFF_ROLES)[number]['key'];
export const STAFF_ROLE_KEYS = STAFF_ROLES.map((r) => r.key) as unknown as readonly [StaffRoleKey, ...StaffRoleKey[]];
export const STAFF_ROLE_LABEL: Record<string, string> = Object.fromEntries(STAFF_ROLES.map((r) => [r.key, r.label]));

// Most powerful first.
const ACCESS_ORDER: UserRole[] = ['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'LIBRARIAN', 'TEACHER'];

/** The access level for a set of roles: the highest any of them gives. */
export function accessFor(roles: readonly string[]): UserRole {
  const levels = new Set(roles.map((k) => STAFF_ROLES.find((r) => r.key === k)?.access).filter(Boolean));
  return ACCESS_ORDER.find((l) => levels.has(l)) ?? 'TEACHER';
}

/** Reads a role the way a person writes it in a spreadsheet: "Head of Department", "head_of_department" or "HOD". */
export function parseStaffRole(raw: string): StaffRoleKey | null {
  const norm = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!norm) return null;
  const hit = STAFF_ROLES.find((r) => r.key.toLowerCase().replace(/_/g, ' ') === norm || r.label.toLowerCase() === norm);
  return hit?.key ?? null;
}

/** The two roles a school must never be without. */
export const REQUIRED_ROLES = ['OWNER', 'ADMINISTRATOR'] as const satisfies readonly StaffRoleKey[];
