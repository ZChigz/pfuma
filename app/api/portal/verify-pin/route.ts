import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody, apiError, withApi } from '@/lib/api';
import { clientIp, getCounterStore } from '@/lib/rate-limit';
import { isValidPin, lookupPortalToken, pinCookieName, pinCookieValue } from '@/lib/portal';

const Schema = z.object({
  token: z.string().min(1).max(200),
  pin:   z.string().refine(isValidPin, 'The PIN is 4 digits'),
});

// A 4-digit PIN has only 10,000 combinations, so guessing is limited twice:
// 5 wrong tries per IP and link, and 20 per link from anywhere, each locks 15 minutes.
const PER_IP = { max: 5, seconds: 15 * 60 };
const PER_LINK = { max: 20, seconds: 15 * 60 };

// Public: checks the PIN once and remembers the device with a signed cookie.
async function _POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if ('error' in parsed) return parsed.error;
  const { token, pin } = parsed.data;

  const found = await lookupPortalToken(token);
  if (found.status !== 'ok' || !found.student.portalPinHash) return apiError('This link is not valid', 404);
  const student = found.student as typeof found.student & { portalPinHash: string };

  const store = getCounterStore();
  const ipKey = `pfuma:pin:ip:${student.id}|${clientIp(req.headers)}`;
  const linkKey = `pfuma:pin:link:${student.id}`;
  const wait = Math.max(await store.ttl(`${ipKey}:lock`), await store.ttl(`${linkKey}:lock`));
  if (wait > 0) {
    return NextResponse.json(
      { success: false, message: 'Too many wrong PINs. Try again in 15 minutes.' },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    );
  }

  if (!(await bcrypt.compare(pin, student.portalPinHash))) {
    if ((await store.incr(ipKey, PER_IP.seconds)) >= PER_IP.max) await store.set(`${ipKey}:lock`, PER_IP.seconds);
    if ((await store.incr(linkKey, PER_LINK.seconds)) >= PER_LINK.max) await store.set(`${linkKey}:lock`, PER_LINK.seconds);
    return apiError('That PIN is not right', 403);
  }

  await store.del(ipKey);
  const res = NextResponse.json({ success: true, data: { verified: true } });
  res.cookies.set(pinCookieName(student.portalTokenHash), pinCookieValue(student), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/portal',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/portal/verify-pin', _POST as H);
