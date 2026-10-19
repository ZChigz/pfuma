import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import { z } from 'zod';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

const UpdateUserSchema = z
  .object({
    active: z.boolean().optional(),
    role:   z.enum(['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN']).optional(),
  })
  .refine((d) => d.active !== undefined || d.role !== undefined, { message: 'Nothing to update' });

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const target = await db.user.findUnique({ where: { id: ctx.params.id } });
  if (!target) return apiNotFound('User');

  const parsed = await parseBody(req, UpdateUserSchema);
  if ('error' in parsed) return parsed.error;
  const { active, role } = parsed.data;

  if (target.id === user.id && (active === false || (role !== undefined && role !== target.role))) {
    return apiError('You cannot deactivate yourself or change your own role', 409);
  }

  const deactivating = active === false && target.active;
  const changingRole = role !== undefined && role !== target.role;

  const updated = await db.$tx(async (tx) => {
    const u = await tx.user.update({
      where: { id: target.id },
      data: {
        ...(active !== undefined ? { active } : {}),
        ...(changingRole ? { role } : {}),
        // Any open session of this user stops working at its next check.
        ...(deactivating || changingRole ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
    const parts: string[] = [];
    if (active !== undefined && active !== target.active) parts.push(active ? 'Reactivated' : 'Deactivated');
    if (changingRole) parts.push(`Role ${target.role} → ${role}`);
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_USER',
        entityType: 'User',
        entityId:   u.id,
        detail:     parts.join('; ') || 'No change',
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
