// Checking a Pfuma staff member's password. Wrong passwords are counted per email + address like a school
// sign-in: five lock that pair for 15 minutes.
import bcrypt from 'bcryptjs';
import { clearLoginFailures, loginLockedFor, recordLoginFailure } from '@/lib/login-guard';
import { logPlatform } from '@/lib/platform/audit';
import { prisma } from '@/lib/prisma';

// Compared against when the email is unknown, so a missing account costs the same time as a wrong password.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', 12));

export type PlatformSignIn =
  | { status: 'ok'; admin: { id: string; fullName: string; email: string; tokenVersion: number } }
  | { status: 'invalid' }
  | { status: 'locked' };

export async function signInPlatformAdmin(rawEmail: string, password: string, meta: { ip: string; userAgent: string }): Promise<PlatformSignIn> {
  const email = rawEmail.trim().toLowerCase();
  const ip = meta.ip || '127.0.0.1';
  const guardKey = `platform:${email}`;
  if ((await loginLockedFor(guardKey, ip)) > 0) return { status: 'locked' };

  const admin = await prisma.platformAdmin.findUnique({ where: { email } });
  let ok = false;
  if (admin?.active) ok = await bcrypt.compare(password, admin.passwordHash);
  else await bcrypt.compare(password, await getDummyHash());

  if (!admin || !ok) {
    const locked = await recordLoginFailure(guardKey, ip, []);
    if (admin) await logPlatform({ id: admin.id, ...meta }, { action: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', entityType: 'PlatformAdmin', entityId: admin.id, detail: `From ${ip}` });
    return locked ? { status: 'locked' } : { status: 'invalid' };
  }

  await clearLoginFailures(guardKey, ip);
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  await logPlatform({ id: admin.id, ...meta }, { action: 'LOGIN_SUCCESS', entityType: 'PlatformAdmin', entityId: admin.id, detail: admin.fullName });
  return { status: 'ok', admin: { id: admin.id, fullName: admin.fullName, email: admin.email, tokenVersion: admin.tokenVersion } };
}
