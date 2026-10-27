// Support access: a Pfuma person looks at a school the way its administrator sees it, read-only, for 30 minutes.
//  * A reason is required, and goes into the school's own audit log as well as the console's.
//  * The person signs in as a hidden "Pfuma support" user of that school (never listed among its users) with a
//    session that carries { support: true }: can() allows looking only, the middleware refuses every change
//    request, and the database refuses writes from it as well.
import { encode } from 'next-auth/jwt';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { logPlatform } from '@/lib/platform/audit';
import type { PlatformAdminContext } from '@/lib/platform/session';
import { prisma } from '@/lib/prisma';

export const SUPPORT_SESSION_SECONDS = 30 * 60;
export const SUPPORT_EMAIL = 'pfuma-support@platform.invalid';

/** The name Auth.js gives its session cookie: with the __Secure- prefix when the site is on https. */
export function schoolSessionCookieName(): string {
  const url = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '';
  return `${url.startsWith('https://') || process.env.NODE_ENV === 'production' ? '__Secure-' : ''}authjs.session-token`;
}

/** Set-Cookie value that ends a school session in this browser. */
export function clearSchoolSessionCookie(): string {
  const name = schoolSessionCookieName();
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${name.startsWith('__Secure-') ? '; Secure' : ''}`;
}

export async function supportUser(schoolId: string) {
  const existing = await prisma.user.findFirst({ where: { schoolId, isSupport: true }, select: { id: true, tokenVersion: true, permVersion: true } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      schoolId, fullName: 'Pfuma support', email: SUPPORT_EMAIL, role: 'ADMIN', isSupport: true, active: true, invitePending: false,
      passwordHash: '!support!never-signs-in-with-a-password',
    },
    select: { id: true, tokenVersion: true, permVersion: true },
  });
}

/** Opens the read-only session. Returns the Set-Cookie value to send to the browser. */
export async function startSupportAccess(admin: PlatformAdminContext, schoolId: string, reason: string) {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) throw new ServiceError('School not found', 404);
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET) is not set');

  const user = await supportUser(schoolId);
  await prisma.$transaction(async (tx) => {
    await logAudit({
      schoolId, actorId: user.id, action: 'SUPPORT_ACCESS_STARTED', entityType: 'School', entityId: schoolId,
      detail: `${admin.fullName} (${admin.email}) from Pfuma support looked in, read-only. Reason: ${reason}`, ip: admin.ip || undefined, userAgent: admin.userAgent || undefined,
    }, tx as never);
    await logPlatform(admin, { action: 'SUPPORT_ACCESS_STARTED', schoolId, entityType: 'School', entityId: schoolId, detail: `${school.name}. Reason: ${reason}` }, tx);
  });

  const name = schoolSessionCookieName();
  const token = await encode({
    secret, salt: name, maxAge: SUPPORT_SESSION_SECONDS,
    token: {
      id: user.id, schoolId, role: 'ADMIN', fullName: 'Pfuma support', email: SUPPORT_EMAIL, tokenVersion: user.tokenVersion,
      mustChangePassword: false, roles: [], permVersion: user.permVersion, checkedAt: Date.now(), support: true, supportAdminId: admin.id,
    },
  });
  const cookie = `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SUPPORT_SESSION_SECONDS}${name.startsWith('__Secure-') ? '; Secure' : ''}`;
  return { cookie, schoolName: school.name, expiresInMinutes: SUPPORT_SESSION_SECONDS / 60 };
}

/** Closes the session from the school side: the end is logged in both audit logs. */
export async function endSupportAccess(session: { userId: string; schoolId: string; adminId: string | null; ip: string; userAgent: string }) {
  await prisma.$transaction(async (tx) => {
    await logAudit({
      schoolId: session.schoolId, actorId: session.userId, action: 'SUPPORT_ACCESS_ENDED', entityType: 'School', entityId: session.schoolId,
      detail: 'Pfuma support left', ip: session.ip || undefined, userAgent: session.userAgent || undefined,
    }, tx as never);
    if (session.adminId && (await tx.platformAdmin.findUnique({ where: { id: session.adminId }, select: { id: true } }))) {
      await logPlatform({ id: session.adminId, ip: session.ip, userAgent: session.userAgent }, { action: 'SUPPORT_ACCESS_ENDED', schoolId: session.schoolId, entityType: 'School', entityId: session.schoolId }, tx);
    }
  });
}
