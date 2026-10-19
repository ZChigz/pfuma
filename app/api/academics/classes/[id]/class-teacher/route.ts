import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { setClassTeacher } from '@/lib/academics/classes';

export const runtime = 'nodejs';

async function _PUT(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.classes.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await setClassTeacher(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/academics/classes/[id]/class-teacher', _PUT as H);
