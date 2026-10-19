import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { deleteGroup, saveGroup } from '@/lib/academics/groups';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await saveGroup(user, id, await readBody(req)));
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await deleteGroup(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/teaching-groups/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/teaching-groups/[id]', _DELETE as H);
