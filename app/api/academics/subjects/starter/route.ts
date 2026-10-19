import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { STARTER_SUBJECTS, loadStarterSubjects } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _GET() {
  await requirePermission('academics.subjects.manage');
  return apiSuccess({ subjects: STARTER_SUBJECTS });
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.subjects.manage');
  return apiSuccess(await loadStarterSubjects(user, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/subjects/starter', _GET as H);
export const POST = withApi('POST /api/academics/subjects/starter', _POST as H);
