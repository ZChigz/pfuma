import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { revokeOverride } from '@/lib/system/access-admin';

// Ends an exception now.
async function _DELETE(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.edit');
  return apiSuccess(await revokeOverride(getScopedDb(user.schoolId, user.id), user, ctx.params.id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const DELETE = withApi('DELETE /api/system/overrides/[id]', _DELETE as H);
