import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { profileActivity } from '@/lib/students/profile';

// The Activity tab: this student's audit log, newest first.
async function _GET(req: Request, ctx?: unknown) {
  const user = await requirePermission('system.audit.view');
  const { id } = (ctx as { params: { id: string } }).params;
  const page = Number(new URL(req.url).searchParams.get('page') ?? '1') || 1;
  return apiSuccess(await profileActivity(user, id, page));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/students/[id]/activity', _GET as H);
