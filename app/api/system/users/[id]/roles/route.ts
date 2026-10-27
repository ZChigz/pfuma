import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { assignRole } from '@/lib/system/access-admin';

// Gives the person a role, for the whole school or pinned to one department, class, hostel or store.
async function _POST(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.edit');
  const body = await req.json().catch(() => ({}));
  return apiSuccess(await assignRole(getScopedDb(user.schoolId, user.id), user, ctx.params.id, body), 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/roles', _POST as H);
