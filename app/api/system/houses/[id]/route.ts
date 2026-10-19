import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { HouseSchema, saveHouse } from '@/lib/students/houses';

async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('system.settings.edit');
  const { id } = (ctx as { params: { id: string } }).params;
  const body = await parseBody(req, HouseSchema);
  if ('error' in body) return body.error;
  return apiSuccess({ house: await saveHouse(user, body.data, id) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/houses/[id]', _PATCH as H);
