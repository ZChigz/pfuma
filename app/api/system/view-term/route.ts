import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/access';
import { apiNotFound, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { VIEW_TERM_COOKIE } from '@/lib/system/view-term';
import { ViewTermSchema } from '@/lib/validations/system';

// Chooses the term this browser LOOKS at. It sets a cookie only: the open term, and
// every record, stay as they are, so there is nothing to audit.
async function _POST(req: Request) {
  const user = await requirePermission('account.term.view');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ViewTermSchema);
  if ('error' in parsed) return parsed.error;

  const term = await db.academicTerm.findFirst({ where: { id: parsed.data.termId, schoolId: user.schoolId }, select: { id: true, name: true } });
  if (!term) return apiNotFound('Term');

  const res = NextResponse.json({ success: true, data: { term } });
  res.cookies.set(VIEW_TERM_COOKIE, term.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  return res;
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/view-term', _POST as H);
