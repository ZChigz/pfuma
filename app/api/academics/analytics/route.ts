import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { analytics } from '@/lib/academics/analytics';

export const runtime = 'nodejs';

async function _GET(req: Request) {
  const user = await requirePermission('academics.analytics.view');
  const q = new URL(req.url).searchParams;
  return apiSuccess(await analytics(user, { termId: q.get('termId') ?? undefined, formId: q.get('formId') ?? undefined, classId: q.get('classId') ?? undefined, departmentId: q.get('departmentId') ?? undefined }));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/analytics', _GET as H);
