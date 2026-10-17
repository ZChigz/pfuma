// Sign-in for Pfuma staff (the /platform console). It is separate from school sign-in: its own table
// (PlatformAdmin), its own cookie, and no school. The cookie holds "adminId.tokenVersion.expiry" and an
// HMAC of that, so it cannot be forged or reused for a school session; a password change or deactivation
// (tokenVersion) ends it at once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { apiUnauthorized } from '@/lib/api';
import { prisma } from '@/lib/prisma';

export const PLATFORM_COOKIE = 'pfuma_platform';
export const PLATFORM_SESSION_SECONDS = 8 * 60 * 60;

export interface PlatformAdminContext {
  id: string;
  email: string;
  fullName: string;
  ip: string;
  userAgent: string;
}

function key(): Buffer {
  const secret = process.env.PLATFORM_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error('PLATFORM_SECRET (or NEXTAUTH_SECRET) is not set');
  return createHmac('sha256', secret).update('pfuma-platform-session-v1').digest();
}

const sign = (payload: string) => createHmac('sha256', key()).update(payload).digest('base64url');

export function signPlatformToken(adminId: string, tokenVersion: number, now = Date.now()): string {
  const payload = `${adminId}.${tokenVersion}.${Math.floor(now / 1000) + PLATFORM_SESSION_SECONDS}`;
  return `${payload}.${sign(payload)}`;
}

/** The admin id and token version in a cookie value, or null when it is not genuine or has expired. */
export function readPlatformToken(value: string | undefined | null, now = Date.now()): { adminId: string; tokenVersion: number } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [adminId, version, expires, signature] = parts;
  const expected = sign(`${adminId}.${version}.${expires}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(version) || !/^\d+$/.test(expires) || Number(expires) * 1000 < now) return null;
  return { adminId, tokenVersion: Number(version) };
}

/** Set-Cookie value for a signed-in admin (maxAge 0 clears it). */
export function platformCookie(value: string, maxAge = PLATFORM_SESSION_SECONDS): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${PLATFORM_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function cookieFrom(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

async function adminFor(value: string | undefined | null) {
  const t = readPlatformToken(value);
  if (!t) return null;
  const admin = await prisma.platformAdmin.findUnique({ where: { id: t.adminId }, select: { id: true, email: true, fullName: true, active: true, tokenVersion: true } });
  if (!admin || !admin.active || admin.tokenVersion !== t.tokenVersion) return null;
  return admin;
}

export const requestMeta = (headers: Headers) => ({
  ip: (headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || '').slice(0, 64),
  userAgent: (headers.get('user-agent') ?? '').slice(0, 300),
});

/** For API routes: the signed-in Pfuma admin, or a 401 Response (withApi returns it as is). */
export async function requirePlatformAdmin(req: Request): Promise<PlatformAdminContext> {
  const admin = await adminFor(cookieFrom(req.headers.get('cookie'), PLATFORM_COOKIE));
  if (!admin) throw apiUnauthorized();
  return { id: admin.id, email: admin.email, fullName: admin.fullName, ...requestMeta(req.headers) };
}

/** For pages: the signed-in admin, or null (the page then redirects to the sign-in). */
export async function getPlatformAdmin() {
  return adminFor(cookies().get(PLATFORM_COOKIE)?.value);
}
