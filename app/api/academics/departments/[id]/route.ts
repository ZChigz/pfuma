import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { deleteDepartment, updateDepartment } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ department: await updateDepartment(user, id, await readBody(req)) });
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await deleteDepartment(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/departments/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/departments/[id]', _DELETE as H);
