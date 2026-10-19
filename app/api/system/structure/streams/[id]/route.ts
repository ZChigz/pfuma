import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { deleteStream, renameStream } from '@/lib/system/structure';
import { StreamNameSchema } from '@/lib/validations/system';

async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, StreamNameSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ stream: await renameStream(db, user, ctx.params.id, parsed.data.name) });
}

async function _DELETE(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.settings.edit');
  const db = getScopedDb(user.schoolId, user.id);
  await deleteStream(db, user, ctx.params.id);
  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/structure/streams/[id]', _PATCH as H);
export const DELETE = withApi('DELETE /api/system/structure/streams/[id]', _DELETE as H);
