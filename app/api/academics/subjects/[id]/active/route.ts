import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { setSubjectActive } from '@/lib/academics/subjects';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.subjects.manage');
  const { id } = (ctx as { params: { id: string } }).params;
  const b = (await readBody(req)) as { active?: unknown };
  return apiSuccess(await setSubjectActive(user, id, b.active === true));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/subjects/[id]/active', _POST as H);
