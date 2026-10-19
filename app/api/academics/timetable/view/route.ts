import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { timetableView } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.timetable.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await timetableView(user, { termId: q.get('termId') ?? undefined, view: (q.get('view') ?? 'master') as 'class', id: q.get('id') ?? undefined, version: q.get('version') ?? undefined, date: q.get('date') ?? undefined }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/timetable/view', _GET as H);
