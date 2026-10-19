import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { lessonSheet, saveLessonRegister } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await lessonSheet(user, q.get('slotId') ?? '', q.get('date') ?? undefined));
}

async function _PUT(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  return apiSuccess(await saveLessonRegister(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/lesson', _GET as H);
export const PUT = withApi('PUT /api/academics/attendance/lesson', _PUT as H);
