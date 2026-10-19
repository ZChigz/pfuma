import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { endAssignment } from '@/lib/academics/assignments';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.assignments.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  await endAssignment(user, id, await readBody(req));
  return apiSuccess({ ended: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/assignments/[id]/end', _POST as H);
