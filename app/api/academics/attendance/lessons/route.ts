import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { myLessons } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await myLessons(user, q.get('date') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/lessons', _GET as H);
