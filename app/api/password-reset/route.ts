import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, parseBody, withApi } from '@/lib/api';
import { clientIp, getCounterStore } from '@/lib/rate-limit';
import { useResetToken } from '@/lib/password-reset';

const Schema = z.object({ token: z.string().min(1).max(200), newPassword: z.string().max(200) });

// Wrong or used links are counted per IP: 10 in 15 minutes locks that IP for 15 minutes.
const MAX = 10;
const WINDOW = 15 * 60;

const MESSAGES = {
  invalid: 'This reset link is not valid.',
  expired: 'This reset link has expired. Ask your administrator for a new one.',
  used: 'This reset link has already been used. Ask your administrator for a new one.',
} as const;

// Public: the link itself is the credential.
async function _POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if ('error' in parsed) return parsed.error;

  const store = getCounterStore();
  const key = `pfuma:reset:ip:${clientIp(req.headers)}`;
  const wait = await store.ttl(`${key}:lock`);
  if (wait > 0) {
    return NextResponse.json(
      { success: false, message: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(wait) } },
    );
  }

  const result = await useResetToken(parsed.data.token, parsed.data.newPassword);
  if (result.status === 'ok') return NextResponse.json({ success: true, data: { reset: true } });
  if (result.status === 'weak') return apiError(result.message, 422);

  if ((await store.incr(key, WINDOW)) >= MAX) await store.set(`${key}:lock`, WINDOW);
  return apiError(MESSAGES[result.status], result.status === 'invalid' ? 404 : 410);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/password-reset', _POST as H);
