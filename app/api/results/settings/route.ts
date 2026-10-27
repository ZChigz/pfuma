import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize, authorizeAny } from '@/lib/access';
import { ResultsSettingsSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

const pick = { passGrade: true, oLevelRanking: true } as const;

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await authorizeAny(user, ['exams.grading.view', 'system.settings.view']);
  const school = await db.school.findUnique({ where: { id: user.schoolId }, select: pick });
  return apiSuccess({ passGrade: school?.passGrade ?? 'C', oLevelRanking: school?.oLevelRanking ?? 'AVERAGE' });
}

// Pass grade ("C or better" = C) and how O Level classes are ranked.
async function _PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.settings.edit');

  const parsed = await parseBody(req, ResultsSettingsSchema);
  if ('error' in parsed) return parsed.error;
  const { passGrade, oLevelRanking } = parsed.data;

  if (passGrade !== undefined) {
    const boundaries = await db.gradeBoundary.findMany({ where: { schoolId: user.schoolId } });
    if (boundaries.length > 0 && !boundaries.some((b) => b.letterGrade === passGrade)) {
      return apiError(`No grade "${passGrade}" in the grade boundaries (${boundaries.map((b) => b.letterGrade).join(', ')})`, 422);
    }
  }

  const school = await db.$tx(async (tx) => {
    const s = await tx.school.update({
      where: { id: user.schoolId },
      data: { ...(passGrade !== undefined ? { passGrade } : {}), ...(oLevelRanking !== undefined ? { oLevelRanking } : {}) },
      select: pick,
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_SCHOOL_SETTINGS',
        entityType: 'School',
        entityId:   user.schoolId,
        detail:     `Pass grade ${s.passGrade}; O Level ranking ${s.oLevelRanking === 'AVERAGE' ? 'by average percentage' : 'by passes then average'}`,
      },
      tx,
    );
    return s;
  });
  return apiSuccess(school);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/results/settings', _GET as H);
export const PATCH = withApi('PATCH /api/results/settings', _PATCH as H);
