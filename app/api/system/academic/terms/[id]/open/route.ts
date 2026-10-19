import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { openTerm } from '@/lib/academic/terms';

// Only one term is open at a time; the service refuses a second one.
async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.settings.edit');
  return apiSuccess({ term: await openTerm(user.schoolId, user.id, ctx.params.id) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/academic/terms/[id]/open', _POST as H);
