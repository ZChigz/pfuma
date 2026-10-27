import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { generateTempPassword, hashPassword } from '@/lib/password';
import type { SessionUser } from '@/types';

async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.users.edit');

  const target = await db.user.findUnique({ where: { id: ctx.params.id } });
  if (!target) return apiNotFound('User');

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.$tx(async (tx) => {
    // tokenVersion ends every session opened with the old password; the user
    // must choose their own password at the next sign-in.
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'RESET_PASSWORD',
        entityType: 'User',
        entityId:   target.id,
      },
      tx,
    );
  });

  return apiSuccess({ tempPassword });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/users/[id]/reset-password', _POST as H);
