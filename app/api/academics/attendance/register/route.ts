import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { dailySheet, saveRegister } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await dailySheet(user, q.get('classId') ?? '', q.get('date') ?? undefined, q.get('session') === 'PM' ? 'PM' : 'AM'));
}

async function _PUT(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  return apiSuccess(await saveRegister(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/register', _GET as H);
export const PUT = withApi('PUT /api/academics/attendance/register', _PUT as H);
