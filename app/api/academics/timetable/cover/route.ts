import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { assignCover, coverCandidates } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.timetable.cover');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await coverCandidates(user, { date: q.get('date') ?? '', absentTeacherId: q.get('teacherId') ?? '' }));
}

async function _POST(req: Request) {
  const user = await requirePermission('academics.timetable.cover');
  return apiSuccess(await assignCover(user, await readBody(req)), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/timetable/cover', _GET as H);
export const POST = withApi('POST /api/academics/timetable/cover', _POST as H);
