import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { getLessonPlan, saveLessonPlan } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.schemes.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess({ plan: await getLessonPlan(user, q.get('slotId') ?? '', q.get('date') ?? '') });
}

async function _PUT(req: Request) {
  const user = await requirePermission('academics.schemes.edit');
  return apiSuccess(await saveLessonPlan(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/lesson-plans', _GET as H);
export const PUT = withApi('PUT /api/academics/lesson-plans', _PUT as H);
