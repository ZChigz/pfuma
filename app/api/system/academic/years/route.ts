import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { createAcademicYear } from '@/lib/academic/terms';
import { CreateYearSchema } from '@/lib/validations/system';

async function _GET() {
  const user = await requirePermission('system.settings.view');
  const db = getScopedDb(user.schoolId, user.id);
  const years = await db.academicYear.findMany({
    where: { schoolId: user.schoolId },
    include: { terms: { orderBy: { termNumber: 'asc' } } },
    orderBy: { year: 'desc' },
  });
  return apiSuccess({ years });
}

// A year and its three terms, with the dates the school chose. Terms may not overlap, and the
// year may not overlap another year.
async function _POST(req: Request) {
  const user = await requirePermission('system.academic.create');
  const parsed = await parseBody(req, CreateYearSchema);
  if ('error' in parsed) return parsed.error;
  const year = await createAcademicYear(user.schoolId, user.id, { year: parsed.data.year, terms: parsed.data.terms });
  return apiSuccess({ year }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/academic/years', _GET as H);
export const POST = withApi('POST /api/system/academic/years', _POST as H);
