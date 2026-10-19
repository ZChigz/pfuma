import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { listRooms, saveRoom } from '@/lib/academics/bell';

export const runtime = 'nodejs';

async function _GET() {
  const user = await requirePermission('academics.timetable.view');
  return apiSuccess({ rooms: await listRooms(user) });
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.timetable.edit');
  return apiSuccess({ room: await saveRoom(user, null, await readBody(req)) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/rooms', _GET as H);
export const POST = withApi('POST /api/academics/rooms', _POST as H);
