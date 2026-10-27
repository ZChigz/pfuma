import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import type { SessionUser } from '@/types';

// Ends every open session of one user (they sign in again with the same password).
async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.users.edit');

  const target = await db.user.findUnique({ where: { id: ctx.params.id } });
  if (!target) return apiNotFound('User');

  await db.$tx(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'LOGOUT_ALL_SESSIONS',
        entityType: 'User',
        entityId:   target.id,
        detail:     `Signed ${target.fullName} out everywhere`,
      },
      tx,
    );
  });

  return apiSuccess({ loggedOut: 1 });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/users/[id]/logout', _POST as H);
