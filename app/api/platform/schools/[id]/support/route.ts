import { NextResponse } from 'next/server';
import { parseBody, withApi } from '@/lib/api';
import { requirePlatformAdmin } from '@/lib/platform/session';
import { startSupportAccess } from '@/lib/platform/support';
import { SupportStartSchema } from '@/lib/validations/platform';

// Opens a read-only view of the school as its administrator would see it. A reason is required and is
// written to both audit logs. The response sets the school session cookie in this browser.
async function _POST(req: Request, ctx: { params: { id: string } }) {
  const admin = await requirePlatformAdmin(req);
  const parsed = await parseBody(req, SupportStartSchema);
  if ('error' in parsed) return parsed.error;
  const { cookie, schoolName, expiresInMinutes } = await startSupportAccess(admin, ctx.params.id, parsed.data.reason);
  const res = NextResponse.json({ success: true, data: { schoolName, expiresInMinutes, redirect: '/system/dashboard' } });
  res.headers.set('Set-Cookie', cookie);
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/platform/schools/[id]/support', _POST as H);
