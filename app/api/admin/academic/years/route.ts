import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageAcademicCalendar } from '@/lib/permissions';
import { CreateAcademicYearSchema } from '@/lib/validations/academic';
import { createAcademicYear } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const years = await db.academicYear.findMany({
    where: { schoolId: user.schoolId },
    include: { terms: { orderBy: { termNumber: 'asc' } } },
    orderBy: { year: 'desc' },
  });
  return apiSuccess({ years });
}

// Creates the year with Terms 1–3 (PLANNED, default dates).
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageAcademicCalendar(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateAcademicYearSchema);
  if ('error' in parsed) return parsed.error;

  const year = await createAcademicYear(user.schoolId, user.id, parsed.data);
  return apiSuccess({ year }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/academic/years',  _GET  as H);
export const POST = withApi('POST /api/admin/academic/years', _POST as H);
