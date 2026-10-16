import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { updateTermDates } from '@/lib/academic/terms';
import { UpdateTermDatesSchema } from '@/lib/validations/system';

async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.academic.update');
  const parsed = await parseBody(req, UpdateTermDatesSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ term: await updateTermDates(user.schoolId, user.id, ctx.params.id, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/academic/terms/[id]', _PATCH as H);
