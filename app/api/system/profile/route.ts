import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { ProfileSchema } from '@/lib/validations/system';

// A person changes their own name. Email and role are changed by an administrator.
async function _PATCH(req: Request) {
  const user = await requirePermission('account.profile.update');
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ProfileSchema);
  if ('error' in parsed) return parsed.error;

  const updated = await db.$tx(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { fullName: parsed.data.fullName }, select: { id: true, fullName: true, email: true, role: true } });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_USER', entityType: 'User', entityId: user.id,
        detail: 'Changed own name', before: { fullName: user.fullName }, after: { fullName: u.fullName },
      },
      tx,
    );
    return u;
  });
  return apiSuccess({ user: updated });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/profile', _PATCH as H);
