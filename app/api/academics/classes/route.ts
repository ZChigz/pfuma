import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { listClasses } from '@/lib/academics/classes';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.classes.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await listClasses(user, q.get('termId') ?? undefined));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/classes', _GET as H);
