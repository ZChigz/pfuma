// Keeps a signed-in session honest: the JWT is only trusted for 60 seconds, after
// which the user's row is read again. A deactivated user, or one whose
// tokenVersion moved on (password reset, "log out all sessions"), loses the session.
// The roles the token carries are rebuilt whenever permVersion has moved (a change of the
// person's roles, exceptions or status, or of the grants of a role they hold), so a removed
// permission stops working within a minute without the person signing out.
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/types';

export const RECHECK_INTERVAL_MS = 60 * 1000;

export interface SessionToken {
  id: string;
  schoolId: string;
  role: UserRole;
  fullName: string;
  tokenVersion: number;
  mustChangePassword: boolean;
  /** Keys of the roles held (OWNER, TEACHER ...), as of the last check. */
  roles?: string[];
  /** User.permVersion as of the last check. */
  permVersion?: number;
  /** Epoch ms of the last database check. */
  checkedAt: number;
  [key: string]: unknown;
}

/** Returns the token to keep, or null to end the session. */
export async function revalidateToken<T extends SessionToken>(token: T, now = Date.now()): Promise<T | null> {
  if (!token.id) return null;
  if (typeof token.checkedAt === 'number' && now - token.checkedAt < RECHECK_INTERVAL_MS && token.checkedAt <= now) {
    return token;
  }
  const row = await prisma.user.findUnique({
    where: { id: token.id },
    select: {
      active: true, role: true, schoolId: true, fullName: true, tokenVersion: true, mustChangePassword: true, permVersion: true,
      userRoles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!row || !row.active || row.tokenVersion !== token.tokenVersion) return null;
  return {
    ...token,
    role: row.role as UserRole,
    schoolId: row.schoolId,
    fullName: row.fullName,
    mustChangePassword: row.mustChangePassword,
    permVersion: row.permVersion,
    roles: Array.from(new Set(row.userRoles.map((r) => r.role.key))),
    checkedAt: now,
  };
}
