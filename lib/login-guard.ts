// Brute-force protection for sign-in: 5 failed attempts per email + IP within
// 15 minutes lock that pair for 15 minutes. Repeated failures are written to the
// AuditLog (when the email belongs to a known user).
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getCounterStore, LIMITS } from '@/lib/rate-limit';

const failKey = (email: string, ip: string) => `pfuma:login:fail:${email.toLowerCase()}|${ip}`;
const lockKey = (email: string, ip: string) => `pfuma:login:lock:${email.toLowerCase()}|${ip}`;

/** Failures from this count on are recorded in the AuditLog. */
export const AUDIT_FROM_FAILURE = 3;

/** Seconds the caller must still wait, or 0 when sign-in may proceed. */
export async function loginLockedFor(email: string, ip: string): Promise<number> {
  return getCounterStore().ttl(lockKey(email, ip));
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await getCounterStore().del(failKey(email, ip));
}

interface KnownUser { id: string; schoolId: string }

/** Counts a failed attempt; returns true when this attempt locked the pair. */
export async function recordLoginFailure(email: string, ip: string, users: KnownUser[]): Promise<boolean> {
  const store = getCounterStore();
  const count = await store.incr(failKey(email, ip), LIMITS.loginWindow);
  const locked = count >= LIMITS.loginMax;
  if (locked) await store.set(lockKey(email, ip), LIMITS.loginLock);

  if (count >= AUDIT_FROM_FAILURE) {
    logger.warn('Repeated login failures', { email, ip, count, locked });
    for (const u of users) {
      try {
        await prisma.auditLog.create({
          data: {
            schoolId: u.schoolId,
            actorId: u.id,
            action: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
            entityType: 'User',
            entityId: u.id,
            detail: locked
              ? `Locked for ${LIMITS.loginLock / 60} minutes after ${count} failed sign-ins from ${ip}`
              : `${count} failed sign-ins from ${ip}`,
          },
        });
      } catch (e) {
        logger.error('Could not write login-failure audit row', e);
      }
    }
  }
  return locked;
}
