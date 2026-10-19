import { NextResponse } from 'next/server';
import { apiError, parseBody, withApi } from '@/lib/api';
import { signInPlatformAdmin } from '@/lib/platform/auth';
import { platformCookie, requestMeta, signPlatformToken } from '@/lib/platform/session';
import { PlatformLoginSchema } from '@/lib/validations/platform';

// Sign-in for Pfuma staff. Five wrong passwords lock the email + address for 15 minutes, like a school sign-in.
async function _POST(req: Request) {
  const parsed = await parseBody(req, PlatformLoginSchema);
  if ('error' in parsed) return parsed.error;

  const result = await signInPlatformAdmin(parsed.data.email, parsed.data.password, requestMeta(req.headers));
  if (result.status === 'locked') return apiError('Too many wrong passwords. Try again in 15 minutes.', 429);
  if (result.status === 'invalid') return apiError('Wrong email or password', 401);

  const { admin } = result;
  const res = NextResponse.json({ success: true, data: { admin: { id: admin.id, fullName: admin.fullName, email: admin.email } } });
  res.headers.set('Set-Cookie', platformCookie(signPlatformToken(admin.id, admin.tokenVersion)));
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/login', _POST as H);
