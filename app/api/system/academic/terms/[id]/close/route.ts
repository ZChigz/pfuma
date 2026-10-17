import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { closeTerm } from '@/lib/academic/terms';

async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.settings.edit');
  return apiSuccess({ term: await closeTerm(user.schoolId, user.id, ctx.params.id) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/academic/terms/[id]/close', _POST as H);
