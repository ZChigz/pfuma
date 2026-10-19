import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { decideSubjectChange } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.approve');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await decideSubjectChange(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/subjects/changes/[id]', _POST as H);
