import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { deleteCustomRole, saveCustomRole } from '@/lib/system/access-admin';

async function _PATCH(req: Request, ctx: { params: { key: string } }) {
  const user = await requirePermission('system.users.edit');
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await saveCustomRole(getScopedDb(user.schoolId, user.id), user, ctx.params.key, body));
}

async function _DELETE(_req: Request, ctx: { params: { key: string } }) {
  const user = await requirePermission('system.users.edit');
  return apiSuccess(await deleteCustomRole(getScopedDb(user.schoolId, user.id), user, ctx.params.key));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/roles/[key]', _PATCH as H);
export const DELETE = withApi('DELETE /api/system/roles/[key]', _DELETE as H);
