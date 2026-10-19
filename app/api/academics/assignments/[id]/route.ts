import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { removeAssignment, updateAssignment } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await updateAssignment(user, id, await readBody(req)));
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await removeAssignment(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/assignments/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/assignments/[id]', _DELETE as H);
