import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import type { SessionUser } from '@/types';

// "Log out all sessions": ends every open session of every user in the school
// except the admin pressing the button (so they are not locked out mid-task).
async function _POST() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const count = await db.$tx(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: { not: user.id } },
      data: { tokenVersion: { increment: 1 } },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'LOGOUT_ALL_SESSIONS',
        entityType: 'School',
        entityId:   user.schoolId,
        detail:     `Signed ${count} user(s) out everywhere`,
      },
      tx,
    );
    return count;
  });

  return apiSuccess({ loggedOut: count });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/users/logout-all', _POST as unknown as H);
