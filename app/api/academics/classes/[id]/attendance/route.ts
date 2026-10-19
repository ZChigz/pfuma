import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { classAttendanceSummary } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.attendance.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const q = new URL(req.url).searchParams;
  return apiSuccess(await classAttendanceSummary(user, id, q.get('termId') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/classes/[id]/attendance', _GET as H);
