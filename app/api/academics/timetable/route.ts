import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { timetableState } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.timetable.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await timetableState(user, q.get('termId') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/timetable', _GET as H);
