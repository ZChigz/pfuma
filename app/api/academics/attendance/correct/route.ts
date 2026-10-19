import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { saveRegister } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _PUT(req: Request) {
  const user = await requirePermission('academics.attendance.correct');
  return apiSuccess(await saveRegister(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/academics/attendance/correct', _PUT as H);
