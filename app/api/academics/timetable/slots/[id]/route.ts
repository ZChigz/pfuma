import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { removeLesson, setLessonRoom } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await removeLesson(user, id));
}

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.timetable.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  const b = (await readBody(req)) as { roomId?: string | null };
  return apiSuccess(await setLessonRoom(user, id, b.roomId ?? null));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const DELETE = withApi('DELETE /api/academics/timetable/slots/[id]', _DELETE as H);
export const PATCH = withApi('PATCH /api/academics/timetable/slots/[id]', _PATCH as H);
