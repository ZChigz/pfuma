import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { resendInvite } from '@/lib/system/users';

// A new link for someone who has not set a password yet; the earlier link stops working.
async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.create');
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess(await resendInvite(db, user, ctx.params.id));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/invite', _POST as H);
