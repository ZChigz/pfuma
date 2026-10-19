import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { getBell, removeTermBell, saveBell } from '@/lib/academics/bell';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.timetable.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await getBell(user, q.get('termId') ?? undefined));
}

async function _PUT(req: Request) {
  const user = await requirePermission('academics.timetable.edit');
  return apiSuccess(await saveBell(user, await readBody(req)));
}

async function _DELETE(req: Request) {
  const user = await requirePermission('academics.timetable.edit');
  const q = new URL(req.url).searchParams;
  await removeTermBell(user, q.get('termId') ?? '');
  return apiSuccess({ removed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/bell', _GET as H);
export const PUT = withApi('PUT /api/academics/bell', _PUT as H);
export const DELETE = withApi('DELETE /api/academics/bell', _DELETE as H);
