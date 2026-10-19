import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { listGroups, saveGroup } from '@/lib/academics/groups';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.assignments.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await listGroups(user, q.get('termId') ?? undefined));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.assignments.manage');
  return apiSuccess(await saveGroup(user, null, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/teaching-groups', _GET as H);
export const POST = withApi('POST /api/academics/teaching-groups', _POST as H);
