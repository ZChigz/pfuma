import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { dailySheet } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.attendance.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await dailySheet(user, q.get('classId') ?? '', q.get('date') ?? undefined, q.get('session') === 'PM' ? 'PM' : 'AM'));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/view', _GET as H);
