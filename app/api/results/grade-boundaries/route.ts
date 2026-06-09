import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, parseBody } from '@/lib/api';
import { canManageGradeBoundaries } from '@/lib/permissions';
import { SaveBoundariesSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const boundaries = await prisma.gradeBoundary.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { minPercent: 'desc' },
  });

  return apiSuccess({
    boundaries: boundaries.map((b) => ({
      ...b,
      minPercent: b.minPercent.toNumber(),
      maxPercent: b.maxPercent.toNumber(),
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try {
    canManageGradeBoundaries(user.role);
  } catch (e) {
    return e as Response;
  }

  const parsed = await parseBody(req, SaveBoundariesSchema);
  if ('error' in parsed) return parsed.error;

  await prisma.$transaction(async (tx) => {
    await tx.gradeBoundary.deleteMany({ where: { schoolId: user.schoolId } });
    await tx.gradeBoundary.createMany({
      data: parsed.data.boundaries.map((b) => ({ ...b, schoolId: user.schoolId })),
    });
  });

  const boundaries = await prisma.gradeBoundary.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { minPercent: 'desc' },
  });

  return apiSuccess({
    boundaries: boundaries.map((b) => ({
      ...b,
      minPercent: b.minPercent.toNumber(),
      maxPercent: b.maxPercent.toNumber(),
    })),
  });
}
