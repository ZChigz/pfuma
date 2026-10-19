import { requirePermission } from '@/lib/access';
import { apiSuccess, readBody, withApi } from '@/lib/api';
import { createScheme, getScheme, saveSchemeWeeks } from '@/lib/academics/curriculum';

export const runtime = 'nodejs';

async function _GET(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.view');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await getScheme(user, id));
}

async function _POST(_req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await createScheme(user, id), 201);
}

async function _PUT(req: Request, ctx?: unknown) {
  const user = await requirePermission('academics.schemes.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  return apiSuccess(await saveSchemeWeeks(user, id, await readBody(req)));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/academics/schemes/[id]', _GET as H);
export const POST = withApi('POST /api/academics/schemes/[id]', _POST as H);
export const PUT = withApi('PUT /api/academics/schemes/[id]', _PUT as H);
