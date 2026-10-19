import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { suggestSlot } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.timetable.edit');
  return apiSuccess(await suggestSlot(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/timetable/suggest', _POST as H);
