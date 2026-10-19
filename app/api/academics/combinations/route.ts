import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { listCombinations, saveCombination } from '@/lib/academics/student-subjects';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.subjects.view');
  return apiSuccess({ combinations: await listCombinations(user) });
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.subjects.manage');
  return apiSuccess(await saveCombination(user, null, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/combinations', _GET as H);
export const POST = withApi('POST /api/academics/combinations', _POST as H);
