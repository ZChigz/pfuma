import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageGradeBoundaries } from '@/lib/permissions';
import { SaveBoundariesSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const boundaries = await db.gradeBoundary.findMany({
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

async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try {
    canManageGradeBoundaries(user.role);
  } catch (e) {
    return e as Response;
  }

  const parsed = await parseBody(req, SaveBoundariesSchema);
  if ('error' in parsed) return parsed.error;

  await db.$tx(async (tx) => {
    await tx.gradeBoundary.deleteMany({ where: { schoolId: user.schoolId } });
    await tx.gradeBoundary.createMany({
      data: parsed.data.boundaries.map((b) => ({ ...b, schoolId: user.schoolId })),
    });
  });

  const boundaries = await db.gradeBoundary.findMany({
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

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/results/grade-boundaries',  _GET  as H);
export const POST = withApi('POST /api/results/grade-boundaries', _POST as H);
