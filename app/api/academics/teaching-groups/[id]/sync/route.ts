import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { syncGroup } from '@/lib/academics/groups';

export const runtime = 'nodejs';

async function _POST(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await syncGroup(user, id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/teaching-groups/[id]/sync', _POST as H);
