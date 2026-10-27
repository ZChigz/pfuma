import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { UpdateSchoolSettingsSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await authorize(user, 'system.settings.view');

  const school = await db.school.findUnique({
    where: { id: user.schoolId },
    select: { maxClassSize: true },
  });
  return apiSuccess({ maxClassSize: school?.maxClassSize ?? 45 });
}

async function _PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'system.settings.edit');

  const parsed = await parseBody(req, UpdateSchoolSettingsSchema);
  if ('error' in parsed) return parsed.error;

  const school = await db.$tx(async (tx) => {
    const s = await tx.school.update({
      where: { id: user.schoolId },
      data: { maxClassSize: parsed.data.maxClassSize },
      select: { maxClassSize: true },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_SCHOOL_SETTINGS',
        entityType: 'School',
        entityId:   user.schoolId,
        detail:     `Class size limit set to ${s.maxClassSize}`,
      },
      tx,
    );
    return s;
  });

  return apiSuccess(school);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/admin/settings',   _GET   as H);
export const PATCH = withApi('PATCH /api/admin/settings', _PATCH as H);
