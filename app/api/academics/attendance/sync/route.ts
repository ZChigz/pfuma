import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { syncRegisters } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.attendance.mark');
  return apiSuccess({ results: await syncRegisters(user, await readBody(req)) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/attendance/sync', _POST as H);
