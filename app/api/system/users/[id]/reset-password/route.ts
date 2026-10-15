import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { resetUserPassword } from '@/lib/system/users';

async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.reset_password');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess(await resetUserPassword(db, user, ctx.params.id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/reset-password', _POST as H);
