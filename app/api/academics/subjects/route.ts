import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { listSubjects, saveSubject } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.subjects.view');
  return apiSuccess(await listSubjects(user));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.subjects.manage');
  return apiSuccess(await saveSubject(user, null, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/subjects', _GET as H);
export const POST = withApi('POST /api/academics/subjects', _POST as H);
