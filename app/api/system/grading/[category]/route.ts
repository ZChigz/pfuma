import { requirePermission } from '@/lib/access';
import { apiError, apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { saveScale } from '@/lib/system/grading';
import { GRADE_CATEGORIES, GradeScaleSchema } from '@/lib/validations/system';

// Replaces the O Level or the A Level scale. Marks already graded keep the grade they were given.
async function _PUT(req: Request, ctx: { params: { category: string } }) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const category = ctx.params.category;
  if (!(GRADE_CATEGORIES as readonly string[]).includes(category)) return apiError('The scale is O_LEVEL or A_LEVEL', 404);
  const parsed = await parseBody(req, GradeScaleSchema);
  if ('error' in parsed) return parsed.error;
  const rows = parsed.data.rows.map((r) => ({ letterGrade: r.letterGrade, minPercent: r.minPercent, maxPercent: r.maxPercent, points: r.points ?? null, remark: r.remark ?? null }));
  return apiSuccess({ scale: await saveScale(db, user, category as (typeof GRADE_CATEGORIES)[number], rows) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/system/grading/[category]', _PUT as H);
