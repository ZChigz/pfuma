// Parent-portal links. The link token is 32 random bytes shown once when it is
// created; only its SHA-256 hash is stored (Student.portalTokenHash), so a
// database leak does not hand out working links. A link expires at the end of
// the school's current academic year unless staff regenerate it.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { BCRYPT_COST } from '@/lib/password';
import type { Db } from '@/lib/scoped-db';

export const PORTAL_TOKEN_BYTES = 32;
export const PORTAL_PIN_LENGTH = 4;
export const PORTAL_VIEW_RETENTION_LIST = 20;

export function generatePortalToken(): string {
  return randomBytes(PORTAL_TOKEN_BYTES).toString('base64url');
}

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generatePortalPin(): string {
  return String(randomInt(0, 10 ** PORTAL_PIN_LENGTH)).padStart(PORTAL_PIN_LENGTH, '0');
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);

export const hashPortalPin = (pin: string) => bcrypt.hash(pin, BCRYPT_COST);

/** End of the school's current academic year; one year from now when none covers today. */
export async function defaultLinkExpiry(db: Db, now = new Date()): Promise<Date> {
  const year =
    (await db.academicYear.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { endDate: 'asc' },
    })) ??
    (await db.academicYear.findFirst({ where: { endDate: { gte: now } }, orderBy: { endDate: 'asc' } }));
  if (year) {
    const end = new Date(year.endDate);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }
  const fallback = new Date(now);
  fallback.setUTCFullYear(fallback.getUTCFullYear() + 1);
  return fallback;
}

export function portalUrl(token: string): string {
  const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').replace(/\/$/, '');
  return `${base}/portal/${token}`;
}

// ─── Lookup (public: no session) ─────────────────────────────────────────────

export type PortalLookup =
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'ok'; student: { id: string; schoolId: string; portalPinHash: string | null; portalTokenHash: string } };

export async function lookupPortalToken(token: string, now = new Date()): Promise<PortalLookup> {
  // Anything that cannot be a token is rejected before touching the database. New
  // tokens are 43 characters (32 bytes); links issued before the hashing change
  // (cuid / UUID, 25–36 characters) are still accepted until they expire.
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return { status: 'invalid' };
  const hash = hashPortalToken(token);
  const student = await prisma.student.findUnique({
    where: { portalTokenHash: hash },
    select: { id: true, schoolId: true, portalPinHash: true, portalTokenHash: true, portalTokenExpiresAt: true },
  });
  if (!student?.portalTokenHash) return { status: 'invalid' };
  if (!student.portalTokenExpiresAt || student.portalTokenExpiresAt <= now) return { status: 'expired' };
  return {
    status: 'ok',
    student: {
      id: student.id,
      schoolId: student.schoolId,
      portalPinHash: student.portalPinHash,
      portalTokenHash: student.portalTokenHash,
    },
  };
}

// ─── PIN: asked once per device ──────────────────────────────────────────────

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET is not set');
  return s;
}

export const pinCookieName = (tokenHash: string) => `ppin_${tokenHash.slice(0, 16)}`;

/** Cookie value proving this device entered the right PIN. Changing the PIN or the link invalidates it. */
export function pinCookieValue(student: { id: string; portalPinHash: string; portalTokenHash: string }): string {
  return createHmac('sha256', secret())
    .update(`${student.id}.${student.portalTokenHash}.${student.portalPinHash}`)
    .digest('base64url');
}

export function pinCookieValid(
  student: { id: string; portalPinHash: string | null; portalTokenHash: string },
  cookie: string | undefined,
): boolean {
  if (!student.portalPinHash) return true; // no PIN set: nothing to ask
  if (!cookie) return false;
  const expected = Buffer.from(pinCookieValue({ ...student, portalPinHash: student.portalPinHash }));
  const given = Buffer.from(cookie);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ─── View log ────────────────────────────────────────────────────────────────

export async function recordPortalView(studentId: string, schoolId: string, ip: string, userAgent: string | null) {
  try {
    await prisma.portalAccessLog.create({
      data: { studentId, schoolId, ip, userAgent: userAgent?.slice(0, 300) ?? null },
    });
  } catch {
    // Viewing the portal must not fail because the log could not be written.
  }
}
