import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { listSubjectChanges } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.subjects.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess({ changes: await listSubjectChanges(user, q.get('status') === 'ALL' ? 'ALL' : 'PENDING') });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/subjects/changes', _GET as H);
