import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { listSchemes } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.schemes.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await listSchemes(user, { termId: q.get('termId') ?? undefined, departmentId: q.get('departmentId') ?? undefined, status: q.get('status') ?? undefined }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/schemes', _GET as H);
