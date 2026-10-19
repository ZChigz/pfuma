import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { decideTimetable } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.timetable.approve');
  return apiSuccess(await decideTimetable(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/timetable/decide', _POST as H);
