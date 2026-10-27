import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { copyRole } from '@/lib/system/access-admin';

// Copies a role into a custom role. The Administrator may then take permissions out of the copy; only the Owner may add to it.
async function _POST(req: Request) {
  const user = await requirePermission('system.users.edit');
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await copyRole(getScopedDb(user.schoolId, user.id), user, body), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/roles', _POST as H);
