import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { defaultLinkExpiry, generatePortalToken, hashPortalToken, portalUrl, PORTAL_VIEW_RETENTION_LIST } from '@/lib/portal';
import type { SessionUser } from '@/types';

// Link state and the most recent views, for staff.
async function _GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'students.guardians.edit');

  const student = await db.student.findUnique({
    where: { id: params.id },
    select: {
      id: true, portalTokenHash: true, portalTokenCreatedAt: true, portalTokenExpiresAt: true, portalPinHash: true,
      portalViews: { orderBy: { createdAt: 'desc' }, take: PORTAL_VIEW_RETENTION_LIST, select: { id: true, ip: true, createdAt: true } },
    },
  });
  if (!student) return apiNotFound('Student');

  return apiSuccess({
    hasLink: !!student.portalTokenHash,
    createdAt: student.portalTokenCreatedAt,
    expiresAt: student.portalTokenExpiresAt,
    hasPin: !!student.portalPinHash,
    views: student.portalViews,
  });
}

// "Regenerate link": issues a new token and invalidates the old one at once.
// The link is returned this one time; only its hash is stored.
async function _POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'students.guardians.edit');

  const student = await db.student.findUnique({ where: { id: params.id }, select: { id: true, portalTokenHash: true } });
  if (!student) return apiNotFound('Student');

  const token = generatePortalToken();
  const now = new Date();
  const expiresAt = await defaultLinkExpiry(db, now);

  await db.$tx(async (tx) => {
    await tx.student.update({
      where: { id: student.id },
      data: {
        portalTokenHash: hashPortalToken(token),
        portalTokenCreatedAt: now,
        portalTokenExpiresAt: expiresAt,
      },
    });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'REGENERATE_PORTAL_LINK',
        entityType: 'Student',
        entityId: student.id,
        detail: `${student.portalTokenHash ? 'Regenerated' : 'Created'} portal link; expires ${expiresAt.toISOString().slice(0, 10)}`,
      },
      tx,
    );
  });

  return apiSuccess({ portalUrl: portalUrl(token), createdAt: now, expiresAt });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/portal-links/[id]', _GET as H);
export const POST = withApi('POST /api/portal-links/[id]', _POST as H);
