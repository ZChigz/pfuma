import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { coverList } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.timetable.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await coverList(user, q.get('date') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/timetable/cover-list', _GET as H);
