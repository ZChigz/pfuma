// Staff password reset: an admin creates a single-use link that works for 30 minutes.
// Only the SHA-256 of the token is stored. (No e-mail is sent: the admin hands the link over.)
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { hashPassword, passwordProblem } from '@/lib/password';
import type { Db } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';

export const RESET_TTL_MS = 30 * 60 * 1000;

export const hashResetToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

export function resetUrl(token: string): string {
  const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').replace(/\/$/, '');
  return `${base}/reset-password/${token}`;
}

/** Makes a new link for a user; earlier unused links stop working. */
export async function createResetToken(tx: Db, schoolId: string, actorId: string, userId: string, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  await tx.passwordResetToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  const row = await tx.passwordResetToken.create({
    data: { userId, tokenHash: hashResetToken(token), expiresAt, createdById: actorId } as never,
  });
  await logAudit(
    { schoolId, actorId, action: 'CREATE_PASSWORD_RESET', entityType: 'User', entityId: userId, detail: `Reset link valid until ${expiresAt.toISOString()}` },
    tx,
  );
  return { token, expiresAt, id: row.id };
}

export type ResetResult =
  | { status: 'ok' }
  | { status: 'invalid' | 'expired' | 'used' }
  | { status: 'weak'; message: string };

/** Looks the link up without using it (for the page that shows the form). */
export async function checkResetToken(token: string, now = new Date()): Promise<'ok' | 'invalid' | 'expired' | 'used'> {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return 'invalid';
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!row) return 'invalid';
  if (row.usedAt) return 'used';
  if (row.expiresAt <= now) return 'expired';
  return 'ok';
}

/** Uses the link once: sets the new password and ends every session of the user. */
export async function useResetToken(token: string, newPassword: string, now = new Date()): Promise<ResetResult> {
  const state = await checkResetToken(token, now);
  if (state !== 'ok') return { status: state };
  const weak = passwordProblem(newPassword);
  if (weak) return { status: 'weak', message: weak };

  const tokenHash = hashResetToken(token);
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    // The conditional update is what makes the link single-use, even for two simultaneous requests.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { status: 'used' } as ResetResult;
    const row = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, tokenVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: { schoolId: row.schoolId, actorId: row.userId, action: 'USE_PASSWORD_RESET', entityType: 'User', entityId: row.userId, detail: 'Password reset with a reset link' },
    });
    return { status: 'ok' } as ResetResult;
  });
}
