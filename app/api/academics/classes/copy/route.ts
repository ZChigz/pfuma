import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { copyFromLastTerm } from '@/lib/academics/classes';

export const runtime = 'nodejs';

async function _POST(req: Request) {
  const user = await requirePermission('academics.classes.manage');
  return apiSuccess(await copyFromLastTerm(user, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/classes/copy', _POST as H);
