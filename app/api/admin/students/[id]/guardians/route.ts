import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiNotFound, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageGuardians } from '@/lib/permissions';
import { AddGuardianSchema } from '@/lib/validations/academic';
import { findOrCreateGuardian, linkGuardian } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';

type Ctx = { params: { id: string } };

async function _GET(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const student = await prisma.student.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
    select: {
      id: true,
      guardians: {
        include: { guardian: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!student) return apiNotFound('Student');
  return apiSuccess({ guardians: student.guardians });
}

// Add a guardian (reusing an existing sibling's guardian with the same name + phone).
async function _POST(req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  try { await canManageGuardians(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const student = await prisma.student.findFirst({ where: { id: params.id, schoolId: user.schoolId }, select: { id: true } });
  if (!student) return apiNotFound('Student');

  const parsed = await parseBody(req, AddGuardianSchema);
  if ('error' in parsed) return parsed.error;
  const { relationship, relationshipNote, isPrimary, isFeePayer, canReceiveSms, ...details } = parsed.data;

  const link = await prisma.$transaction(async (tx) => {
    const guardian = await findOrCreateGuardian(tx, user.schoolId, user.id, details);
    return linkGuardian(tx, user.schoolId, user.id, student.id, guardian.id, {
      relationship, relationshipNote, isPrimary, isFeePayer, canReceiveSms,
    });
  });
  return apiSuccess({ link }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/students/[id]/guardians',  _GET  as unknown as H);
export const POST = withApi('POST /api/admin/students/[id]/guardians', _POST as unknown as H);
