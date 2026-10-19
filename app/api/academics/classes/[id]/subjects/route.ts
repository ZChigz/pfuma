import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { classSubjectTeachers } from '@/lib/academics/classes';

export const runtime = 'nodejs';

async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.classes.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const q = new URL(req.url).searchParams;
  return apiSuccess(await classSubjectTeachers(user, id, q.get('termId') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/classes/[id]/subjects', _GET as H);
