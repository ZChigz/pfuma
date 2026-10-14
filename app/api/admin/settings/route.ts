import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageClasses } from '@/lib/permissions';
import { UpdateSchoolSettingsSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { maxClassSize: true },
  });
  return apiSuccess({ maxClassSize: school?.maxClassSize ?? 45 });
}

async function _PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, UpdateSchoolSettingsSchema);
  if ('error' in parsed) return parsed.error;

  const school = await prisma.$transaction(async (tx) => {
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
