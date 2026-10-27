// Which students a user may reach. The answer comes from the engine (lib/access): the scope at which the person holds the key they are
// using. Held for the whole school (the Owner, the Head, the Administrator, a bursar looking a child up) it reaches every student; held for
// a class (a class teacher) or for the classes taught (a subject teacher) it reaches those students; for a department (a head of
// department) the students taking the department's subjects; for a hostel (a boarding master, the matron) its boarders.
import type { Prisma } from '@prisma/client';
import { schoolWide, type AccessUser, type PermissionKey } from '@/lib/access-core';
import { scopeWhere } from '@/lib/access/where';
import type { Db } from '@/lib/scoped-db';

/** True when the key reaches every student of the school (no narrowing). */
export const reachesEveryStudent = (user: AccessUser, key: PermissionKey = 'students.profiles.view') => schoolWide(user, key);

/**
 * A Prisma filter for Student, always including the school, limited to what the person's grants of `key` reach. Use it in every list,
 * search, export and lookup of students. `termId` is no longer needed (the engine works out the open term); it is kept so older
 * callers read the same.
 */
export async function studentScope(user: AccessUser, _termId?: string | null, key: PermissionKey = 'students.profiles.view', db?: Db): Promise<Prisma.StudentWhereInput> {
  return (await scopeWhere(user, key, 'Student', db)) as Prisma.StudentWhereInput;
}
