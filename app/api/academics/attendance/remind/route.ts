import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { remindRegisters } from '@/lib/academics/attendance';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.attendance.correct');
  const b = (await readBody(req)) as { classIds?: string[]; date?: string };
  return apiSuccess(await remindRegisters(user, Array.isArray(b.classIds) ? b.classIds.slice(0, 100) : [], b.date));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/attendance/remind', _POST as H);
