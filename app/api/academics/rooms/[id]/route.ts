import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { deleteRoom, saveRoom } from '@/lib/academics/bell';

export const runtime = 'nodejs';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess({ room: await saveRoom(user, id, await readBody(req)) });
}

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  await deleteRoom(user, id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/academics/rooms/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/academics/rooms/[id]', _DELETE as H);
