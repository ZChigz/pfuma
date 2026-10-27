import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { createOverride } from '@/lib/system/access-admin';

// An exception for one person: one permission, a reason and an end date (at most 90 days).
async function _POST(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.edit');
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await createOverride(getScopedDb(user.schoolId, user.id), user, ctx.params.id, body), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/overrides', _POST as H);
