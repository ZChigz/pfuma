import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { deleteTopic, saveTopic } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.syllabus.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ topic: await saveTopic(user, id, await readBody(req)) });
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.syllabus.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await deleteTopic(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/syllabus/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/syllabus/[id]', _DELETE as H);
