import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { startNewVersion } from '@/lib/academics/timetable';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.timetable.edit');
  const b = (await readBody(req)) as { termId?: string };
  return apiSuccess(await startNewVersion(user, b.termId), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/timetable/new-version', _POST as H);
