import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageUsers } from '@/lib/permissions';
import { CreateUserSchema } from '@/lib/validations/admin';
import { generateTempPassword, hashPassword } from '@/lib/password';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const users = await db.user.findMany({
    where: { schoolId: user.schoolId, isSupport: false },
    select: { id: true, fullName: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { fullName: 'asc' },
  });

  return apiSuccess({ users });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageUsers(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateUserSchema);
  if ('error' in parsed) return parsed.error;
  const { fullName, email, role } = parsed.data;

  const existing = await db.user.findFirst({
    where: { schoolId: user.schoolId, email },
  });
  if (existing) return apiError('A user with this email already exists', 409);

  // The temporary password is shown to the admin once; the new user must replace
  // it at first sign-in.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const created = await db.$tx(async (tx) => {
    const newUser = await tx.user.create({
      data: { schoolId: user.schoolId, fullName, email, role, passwordHash, mustChangePassword: true },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_USER',
        entityType: 'User',
        entityId:   newUser.id,
        detail:     `${fullName} (${role})`,
      },
      tx,
    );
    return newUser;
  });

  return apiSuccess(
    {
      user: {
        id: created.id,
        fullName: created.fullName,
        email: created.email,
        role: created.role,
        active: created.active,
      },
      tempPassword,
    },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/users',  _GET  as H);
export const POST = withApi('POST /api/admin/users', _POST as H);
