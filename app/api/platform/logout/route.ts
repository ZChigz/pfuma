import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api';
import { platformCookie } from '@/lib/platform/session';

async function _POST() {
  const res = NextResponse.json({ success: true, data: {} });
  res.headers.set('Set-Cookie', platformCookie('', 0));
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/logout', _POST as H);
