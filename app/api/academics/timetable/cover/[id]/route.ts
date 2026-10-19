import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { removeCover } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.cover');
  const { id } = (ctx as { params: { id: string } }).params;
  await removeCover(user, id);
  return apiSuccess({ removed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const DELETE = withApi('DELETE /api/academics/timetable/cover/[id]', _DELETE as H);
