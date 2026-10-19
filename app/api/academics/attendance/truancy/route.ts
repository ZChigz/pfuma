import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { truancyList } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.attendance.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess({ flagged: await truancyList(user, q.get('date') ?? undefined) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/truancy', _GET as H);
