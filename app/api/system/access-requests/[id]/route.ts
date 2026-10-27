import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { decideRequest } from '@/lib/system/access-admin';

// Approves a request as a time-limited exception, or declines it with a reason.
async function _POST(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.edit');
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await decideRequest(getScopedDb(user.schoolId, user.id), user, ctx.params.id, body));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/access-requests/[id]', _POST as H);
