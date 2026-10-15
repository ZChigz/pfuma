import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { setUserActive } from '@/lib/system/users';

async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.deactivate');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess({ user: await setUserActive(db, user, ctx.params.id, false) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/deactivate', _POST as H);
