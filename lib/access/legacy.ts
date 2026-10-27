// Scope checks for the older mark-sheet routes, which work on SubjectAssignment rows (one teacher, one subject, one class, one term).
import type { AccessUser } from '@/lib/access-core';
import { schoolWide } from '@/lib/access-core';
import { grantsFor } from './effective';
import { reach } from './scopes';
import { effectiveOf } from './user';

/**
 * Whether the person reaches a mark sheet through any of these keys: a school-wide grant, being the teacher of the sheet, or holding the
 * key for a department that the sheet's subject belongs to. Nothing here looks at a role name: a teacher is "the sheet's teacher",
 * a head of department is "a department grant", the Head is "school-wide".
 */
export async function reachesSheet(user: AccessUser, keys: readonly string[], sheet: { teacherId: string | null; subjectId: string }): Promise<boolean> {
  if (keys.some((k) => schoolWide(user, k))) return true;
  if (sheet.teacherId && sheet.teacherId === user.id && keys.some((k) => grantsFor(effectiveOf(user), k).length > 0)) return true;
  const departmental = keys.filter((k) => grantsFor(effectiveOf(user), k).some((g) => g.scope === 'DEPARTMENT'));
  if (!departmental.length) return false;
  const pins = departmental.flatMap((k) => grantsFor(effectiveOf(user), k).filter((g) => g.scope === 'DEPARTMENT' && g.scopeId).map((g) => g.scopeId!));
  return (await reach(user, 'DEPARTMENT', { pins })).subjectIds.includes(sheet.subjectId);
}
