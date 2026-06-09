import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canApplyCharge } from '@/lib/permissions';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try {
    await canApplyCharge(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const existing = await prisma.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true },
  });
  if (!existing) return apiNotFound('Student');

  const newToken = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.student.update({
      where: { id: params.id },
      data: { portalToken: newToken },
    });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'UPDATE_STUDENT',
        entityType: 'Student',
        entityId: params.id,
        detail: 'Portal token regenerated',
      },
      tx,
    );
  });

  return apiSuccess({
    portalUrl: `${process.env.NEXTAUTH_URL}/portal/${newToken}`,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/students/[id]/portal-link', _POST as H);
