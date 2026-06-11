import bcrypt from 'bcryptjs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import { generateTempPassword } from '@/lib/utils';
import type { SessionUser } from '@/types';

async function _POST(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const target = await prisma.user.findUnique({ where: { id: ctx.params.id } });
  if (!target || target.schoolId !== user.schoolId) return apiNotFound('User');

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
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
