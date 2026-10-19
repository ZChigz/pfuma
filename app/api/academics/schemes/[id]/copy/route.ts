import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { copySchemeFromLastYear } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _POST(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  const b = (await readBody(req)) as { overwrite?: boolean };
  return apiSuccess(await copySchemeFromLastYear(user, id, b.overwrite === true));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/academics/schemes/[id]/copy', _POST as H);
