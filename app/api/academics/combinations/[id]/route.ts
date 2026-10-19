import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { deleteCombination, saveCombination } from '@/lib/academics/student-subjects';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await saveCombination(user, id, await readBody(req)));
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await deleteCombination(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/combinations/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/combinations/[id]', _DELETE as H);
