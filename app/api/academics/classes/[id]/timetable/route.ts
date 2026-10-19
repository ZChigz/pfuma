import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { timetableView } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const q = new URL(req.url).searchParams;
  return apiSuccess(await timetableView(user, { termId: q.get('termId') ?? undefined, view: 'class', id }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/classes/[id]/timetable', _GET as H);
