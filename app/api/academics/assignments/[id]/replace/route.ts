import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { replaceTeacher } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await replaceTeacher(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/assignments/[id]/replace', _POST as H);
