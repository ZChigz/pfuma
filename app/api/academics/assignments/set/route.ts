import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { assignmentSet, submitAssignments } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.assignments.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await assignmentSet(user, q.get('termId') ?? undefined));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.assignments.manage');
  const b = (await readBody(req)) as { termId?: string };
  return apiSuccess(await submitAssignments(user, b.termId));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/assignments/set', _GET as H);
export const POST = withApi('POST /api/academics/assignments/set', _POST as H);
