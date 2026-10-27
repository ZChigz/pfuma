import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { describeAccess } from '@/lib/system/access-admin';

async function _GET(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.roles.view');
  return apiSuccess(await describeAccess(getScopedDb(user.schoolId, user.id), ctx.params.id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/system/users/[id]/access', _GET as H);
