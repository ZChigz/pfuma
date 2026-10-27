import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiNotFound, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { authorize } from '@/lib/access';
import { createResetToken, resetUrl } from '@/lib/password-reset';
import type { SessionUser } from '@/types';

// Creates a password-reset link for a staff member: valid 30 minutes, usable once.
// It is shown once; the admin passes it on. Creating a new one cancels the old one.
async function _POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.users.edit');

  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) return apiNotFound('User');
  if (!target.active) return apiError('This account is deactivated. Reactivate it first.', 409);

  const { token, expiresAt } = await db.$tx((tx) => createResetToken(tx, user.schoolId, user.id, target.id));
  return apiSuccess({ resetUrl: resetUrl(token), expiresAt });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/users/[id]/reset-link', _POST as H);
