import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { removeRole } from '@/lib/system/access-admin';

async function _DELETE(_req: Request, ctx: { params: { id: string; roleRowId: string } }) {
  const user = await requirePermission('system.users.edit');
  return apiSuccess(await removeRole(getScopedDb(user.schoolId, user.id), user, ctx.params.id, ctx.params.roleRowId));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const DELETE = withApi('DELETE /api/system/users/[id]/roles/[roleRowId]', _DELETE as H);
