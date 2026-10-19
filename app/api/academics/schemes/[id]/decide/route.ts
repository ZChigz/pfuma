import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { decideScheme } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.approve');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await decideScheme(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/schemes/[id]/decide', _POST as H);
