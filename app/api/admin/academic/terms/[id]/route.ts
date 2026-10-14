import { auth } from '@/lib/auth';
import { apiError, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageAcademicCalendar } from '@/lib/permissions';
import { UpdateTermDatesSchema } from '@/lib/validations/academic';
import { closeTerm, openTerm, updateTermDates } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

type Ctx = { params: { id: string } };

async function session() {
  const s = await auth();
  if (!s?.user?.id) return null;
  return s.user as unknown as SessionUser;
}

// Change a term's dates.
async function _PATCH(req: Request, { params }: Ctx) {
  const user = await session();
  if (!user) return apiUnauthorized();
  try { await canManageAcademicCalendar(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, UpdateTermDatesSchema);
  if ('error' in parsed) return parsed.error;
  const term = await updateTermDates(user.schoolId, user.id, params.id, parsed.data);
  return apiSuccess({ term });
}

// POST ?action=open | close
async function _POST(req: Request, { params }: Ctx) {
  const user = await session();
  if (!user) return apiUnauthorized();
  try { await canManageAcademicCalendar(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const action = new URL(req.url).searchParams.get('action');
  if (action === 'open') return apiSuccess({ term: await openTerm(user.schoolId, user.id, params.id) });
  if (action === 'close') return apiSuccess({ term: await closeTerm(user.schoolId, user.id, params.id) });
  return apiError('action must be "open" or "close"', 400);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/admin/academic/terms/[id]', _PATCH as unknown as H);
export const POST  = withApi('POST /api/admin/academic/terms/[id]',  _POST  as unknown as H);
