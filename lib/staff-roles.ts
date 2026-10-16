// The 13 roles a person can hold at the school, and the access level (the older single role the
// existing pages use) that goes with each. A person with several roles gets the highest level.
import type { UserRole } from '@/types';

export const STAFF_ROLES = [
  { key: 'SCHOOL_ADMINISTRATOR', label: 'School Administrator', access: 'ADMIN' },
  { key: 'OWNER',                label: 'Owner',                access: 'DIRECTOR' },
  { key: 'HEAD_TEACHER',         label: 'Head Teacher',         access: 'HEAD' },
  { key: 'DEPUTY_HEAD',          label: 'Deputy Head',          access: 'HEAD' },
  { key: 'SENIOR_TEACHER',       label: 'Senior Teacher',       access: 'TEACHER' },
  { key: 'HEAD_OF_DEPARTMENT',   label: 'Head of Department',   access: 'TEACHER' },
  { key: 'CLASS_TEACHER',        label: 'Class Teacher',        access: 'TEACHER' },
  { key: 'TEACHER',              label: 'Teacher',              access: 'TEACHER' },
  { key: 'BURSAR',               label: 'Bursar',               access: 'BURSAR' },
  { key: 'ACCOUNTS_CLERK',       label: 'Accounts Clerk',       access: 'BURSAR' },
  { key: 'LIBRARIAN',            label: 'Librarian',            access: 'LIBRARIAN' },
  { key: 'REGISTRAR',            label: 'Registrar',            access: 'TEACHER' },
  { key: 'OFFICE_SECRETARY',     label: 'Office Secretary',     access: 'TEACHER' },
] as const satisfies readonly { key: string; label: string; access: UserRole }[];

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

/** Reads a role the way a person writes it in a spreadsheet: "Head Teacher", "head_teacher", "HOD"-style names are not guessed. */
export function parseStaffRole(raw: string): StaffRoleKey | null {
  const norm = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!norm) return null;
  const hit = STAFF_ROLES.find((r) => r.key.toLowerCase().replace(/_/g, ' ') === norm || r.label.toLowerCase() === norm);
  return hit?.key ?? null;
}
