// Which students a user may reach. Owner and Administrator ("*") reach every student of their school.
// Every other role that has been given students.profiles.view reaches only students it teaches: the class
// teacher's class, or a class the person has a subject allocation for in the open term. (Wider scopes,
// such as a department or a hostel, come later; when they do, only this file changes.)
import type { Prisma } from '@prisma/client';
import { WILDCARD, type AccessUser } from '@/lib/access-core';

export const reachesEveryStudent = (user: AccessUser) => (user.grants ?? []).includes(WILDCARD);

/**
 * A Prisma filter for Student. Always includes the school. `termId` is the open term, used to find the
 * subject allocations of a teacher; without a term only the class teacher's own classes count.
 */
export function studentScope(user: AccessUser, termId?: string | null): Prisma.StudentWhereInput {
  if (reachesEveryStudent(user)) return { schoolId: user.schoolId };
  const taught: Prisma.SchoolClassWhereInput[] = [{ classTeacherId: user.id }];
  if (termId) taught.push({ assignments: { some: { teacherId: user.id, termId } } });
  const or: Prisma.StudentWhereInput[] = [{ currentClass: { OR: taught } }];
  if (termId) or.push({ enrollments: { some: { termId, class: { OR: taught } } } });
  return { schoolId: user.schoolId, OR: or };
}
