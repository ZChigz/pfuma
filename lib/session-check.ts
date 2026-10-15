// Keeps a signed-in session honest: the JWT is only trusted for 5 minutes, after
// which the user's row is read again. A deactivated user, or one whose
// tokenVersion moved on (role change, school change, password reset, "log out
// all sessions"), loses the session; a changed role is picked up.
import { prisma } from '@/lib/prisma';
import type { UserRole } from '@/types';

export const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionToken {
  id: string;
  schoolId: string;
  role: UserRole;
  fullName: string;
  tokenVersion: number;
  mustChangePassword: boolean;
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
    select: { active: true, role: true, schoolId: true, fullName: true, tokenVersion: true, mustChangePassword: true },
  });
  if (!row || !row.active || row.tokenVersion !== token.tokenVersion) return null;
  return {
    ...token,
    role: row.role as UserRole,
    schoolId: row.schoolId,
    fullName: row.fullName,
    mustChangePassword: row.mustChangePassword,
    checkedAt: now,
  };
}
