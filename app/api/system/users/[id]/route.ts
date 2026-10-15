import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { updateUser } from '@/lib/system/users';
import { SystemUpdateUserSchema } from '@/lib/validations/system';

async function _PATCH(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, SystemUpdateUserSchema);
  if ('error' in parsed) return parsed.error;
  return apiSuccess({ user: await updateUser(db, user, ctx.params.id, parsed.data) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/users/[id]', _PATCH as H);
