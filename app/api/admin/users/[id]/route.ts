import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import { z } from 'zod';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

const UpdateUserSchema = z.object({
  active: z.boolean(),
});

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const target = await prisma.user.findUnique({ where: { id: ctx.params.id } });
  if (!target || target.schoolId !== user.schoolId) return apiNotFound('User');

  const parsed = await parseBody(req, UpdateUserSchema);
  if ('error' in parsed) return parsed.error;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: target.id },
      data: { active: parsed.data.active },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_USER',
        entityType: 'User',
        entityId:   u.id,
        detail:     parsed.data.active ? 'Reactivated' : 'Deactivated',
      },
      tx,
    );
    return u;
  });

  return apiSuccess({
    user: { id: updated.id, fullName: updated.fullName, email: updated.email, role: updated.role, active: updated.active },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/admin/users/[id]', _PATCH as H);
