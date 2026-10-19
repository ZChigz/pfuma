import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { submitScheme } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _POST(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await submitScheme(user, id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/schemes/[id]/submit', _POST as H);
