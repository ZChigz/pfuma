import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { decideAssignments } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.assignments.approve');
  return apiSuccess(await decideAssignments(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/assignments/set/decide', _POST as H);
