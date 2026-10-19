import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { registerDue } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.attendance.mark');
  return apiSuccess({ due: await registerDue(user) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/attendance/due', _GET as H);
