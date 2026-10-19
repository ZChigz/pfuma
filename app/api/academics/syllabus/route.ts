import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { saveTopic, syllabusIndex, syllabusTree } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.schemes.view');
  const q = new URL(req.url).searchParams;
  if (q.get('subjectId') && q.get('levelId')) return apiSuccess(await syllabusTree(user, q.get('subjectId')!, q.get('levelId')!));
  return apiSuccess(await syllabusIndex(user));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.syllabus.manage');
  return apiSuccess({ topic: await saveTopic(user, null, await readBody(req)) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/syllabus', _GET as H);
export const POST = withApi('POST /api/academics/syllabus', _POST as H);
