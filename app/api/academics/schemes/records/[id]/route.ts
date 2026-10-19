import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { saveRecord } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _PUT(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await saveRecord(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PUT = withApi('PUT /api/academics/schemes/records/[id]', _PUT as H);
