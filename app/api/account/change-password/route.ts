import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { hashPassword, passwordProblem } from '@/lib/password';
import { clearLoginFailures, loginLockedFor, recordLoginFailure } from '@/lib/login-guard';
import { clientIp } from '@/lib/rate-limit';
import type { SessionUser } from '@/types';

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword:     z.string(),
});

// Lets a signed-in user choose their own password. Required after an admin
// created the account or reset the password. Ends every session (including
// this one) so the user signs in again with the new password.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const parsed = await parseBody(req, ChangePasswordSchema);
  if ('error' in parsed) return parsed.error;
  const { currentPassword, newPassword } = parsed.data;

  const ip = clientIp(req.headers);
  if ((await loginLockedFor(user.email, ip)) > 0) {
    return apiError('Too many wrong passwords. Try again in 15 minutes.', 429);
  }

  const problem = passwordProblem(newPassword);
  if (problem) return apiError(problem, 422);
  if (newPassword === currentPassword) return apiError('Choose a password different from the current one', 422);

  const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await bcrypt.compare(currentPassword, row.passwordHash))) {
    await recordLoginFailure(user.email, ip, [{ id: user.id, schoolId: user.schoolId }]);
    return apiError('Your current password is wrong', 403);
  }
  await clearLoginFailures(user.email, ip);

  const passwordHash = await hashPassword(newPassword);
  await db.$tx(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CHANGE_PASSWORD',
        entityType: 'User',
        entityId:   user.id,
      },
      tx,
    );
  });

  return apiSuccess({ changed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/account/change-password', _POST as H);
