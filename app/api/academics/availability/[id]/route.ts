import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { getAvailability, setAvailability } from '@/lib/academics/bell';

export const runtime = 'nodejs';

async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  const q = new URL(req.url).searchParams;
  return apiSuccess(await getAvailability(user, id, q.get('termId') ?? undefined));
}

async function _PUT(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await setAvailability(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/availability/[id]', _GET as H);
export const PUT = withApi('PUT /api/academics/availability/[id]', _PUT as H);
