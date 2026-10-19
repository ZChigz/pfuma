import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { apiForbidden, apiUnauthorized, withApi } from '@/lib/api';
import { requestMeta } from '@/lib/platform/session';
import { clearSchoolSessionCookie, endSupportAccess } from '@/lib/platform/support';

// "Leave" in the support banner: logs the end of the visit and signs the support session out.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  if (!session.user.support) return apiForbidden();
  const meta = requestMeta(req.headers);
  await endSupportAccess({ userId: session.user.id, schoolId: session.user.schoolId, adminId: session.user.supportAdminId ?? null, ...meta });
  const res = NextResponse.json({ success: true, data: { redirect: session.user.supportAdminId ? `/platform/schools/${session.user.schoolId}` : '/platform' } });
  res.headers.set('Set-Cookie', clearSchoolSessionCookie());
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/support/end', _POST as H);
