import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiNotFound, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize, authorizeAny } from '@/lib/access';
import { validateBoundaries } from '@/lib/results';
import { SaveBoundariesSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

const serialize = (b: { minPercent: { toNumber(): number }; maxPercent: { toNumber(): number } } & Record<string, unknown>) => ({
  ...b,
  minPercent: b.minPercent.toNumber(),
  maxPercent: b.maxPercent.toNumber(),
});

// All boundary sets of the school. Rows carry levelId / termId (null = applies to all).
async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await authorizeAny(user, ['exams.grading.view', 'system.settings.view']);

  // The O Level and A Level scales of Settings → Grading are managed there, not here.
  const boundaries = await db.gradeBoundary.findMany({
    where: { schoolId: user.schoolId, category: null },
    orderBy: { minPercent: 'desc' },
  });
  return apiSuccess({ boundaries: boundaries.map(serialize) });
}

// Replaces ONE set (a level and/or term, or the school-wide set). The set must run
// from 0 to 100 with no overlaps or gaps. Marks already published keep their grades:
// each mark stores the boundary it was graded with.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.settings.edit');

  const parsed = await parseBody(req, SaveBoundariesSchema);
  if ('error' in parsed) return parsed.error;
  const levelId = parsed.data.levelId ?? null;
  const termId = parsed.data.termId ?? null;
  const rows = parsed.data.boundaries;

  const problem = validateBoundaries(rows);
  if (problem) return apiError(problem, 422);

  const [level, term] = await Promise.all([
    levelId ? db.level.findFirst({ where: { id: levelId, schoolId: user.schoolId } }) : null,
    termId ? db.academicTerm.findFirst({ where: { id: termId, schoolId: user.schoolId } }) : null,
  ]);
  if (levelId && !level) return apiNotFound('Level');
  if (termId && !term) return apiNotFound('Term');

  await db.$tx(async (tx) => {
    await tx.gradeBoundary.deleteMany({ where: { schoolId: user.schoolId, levelId, termId, category: null } });
    await tx.gradeBoundary.createMany({ data: rows.map((b) => ({ ...b, schoolId: user.schoolId, levelId, termId })) });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_GRADE_BOUNDARIES',
        entityType: 'GradeBoundary',
        entityId:   `${levelId ?? 'all'}:${termId ?? 'all'}`,
        detail:     `${level?.name ?? 'All levels'}, ${term?.name ?? 'all terms'}: ${rows.map((b) => `${b.letterGrade} ${b.minPercent}–${b.maxPercent}`).join(', ')}`,
      },
      tx,
    );
  });

  const boundaries = await db.gradeBoundary.findMany({ where: { schoolId: user.schoolId, category: null }, orderBy: { minPercent: 'desc' } });
  return apiSuccess({ boundaries: boundaries.map(serialize) });
}

// Removes a level/term-specific set so that class falls back to the more general one.
// The school-wide set cannot be removed.
async function _DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.settings.edit');

  const q = new URL(req.url).searchParams;
  const levelId = q.get('levelId') || null;
  const termId = q.get('termId') || null;
  if (!levelId && !termId) return apiError('The school-wide boundaries cannot be removed; edit them instead', 409);

  await db.$tx(async (tx) => {
    const { count } = await tx.gradeBoundary.deleteMany({ where: { schoolId: user.schoolId, levelId, termId, category: null } });
    // Nothing removed (an unknown or foreign level id): nothing changed, so nothing to record.
    if (count === 0) return;
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_GRADE_BOUNDARIES',
        entityType: 'GradeBoundary',
        entityId:   `${levelId ?? 'all'}:${termId ?? 'all'}`,
        detail:     'Removed this set of boundaries',
      },
      tx,
    );
  });
  return apiSuccess({ removed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET    = withApi('GET /api/results/grade-boundaries',    _GET    as H);
export const POST   = withApi('POST /api/results/grade-boundaries',   _POST   as H);
export const DELETE = withApi('DELETE /api/results/grade-boundaries', _DELETE as H);
