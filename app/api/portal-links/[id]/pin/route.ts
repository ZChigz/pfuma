import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManagePortalLinks } from '@/lib/permissions';
import { generatePortalPin, hashPortalPin } from '@/lib/portal';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import { buildWhatsAppLink } from '@/lib/utils';
import type { SessionUser } from '@/types';

// Sets (or resets) the optional 4-digit PIN. The PIN is stored hashed and
// returned once, with a ready-made message for the primary guardian's phone.
async function _POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManagePortalLinks(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const student = await db.student.findUnique({
    where: { id: params.id },
    select: { id: true, fullName: true, portalTokenHash: true, guardians: PRIMARY_GUARDIAN_INCLUDE },
  });
  if (!student) return apiNotFound('Student');
  if (!student.portalTokenHash) return apiError('Create the portal link first', 409);

  const phone = student.guardians[0]?.guardian.phone ?? null;
  const pin = generatePortalPin();
  const pinHash = await hashPortalPin(pin);

  await db.$tx(async (tx) => {
    await tx.student.update({ where: { id: student.id }, data: { portalPinHash: pinHash } });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'SET_PORTAL_PIN',
        entityType: 'Student',
        entityId: student.id,
        detail: 'Portal PIN set',
      },
      tx,
    );
  });

  const message = `Your PIN for ${student.fullName}'s school portal is ${pin}. You will be asked for it the first time you open the link on a device.`;
  return apiSuccess({
    pin,
    guardianPhone: phone,
    whatsappUrl: phone ? buildWhatsAppLink(phone, message) : null,
    smsUrl: phone ? `sms:${phone}?&body=${encodeURIComponent(message)}` : null,
  });
}

// Removes the PIN; the link then works without one.
async function _DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManagePortalLinks(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const student = await db.student.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!student) return apiNotFound('Student');

  await db.$tx(async (tx) => {
    await tx.student.update({ where: { id: student.id }, data: { portalPinHash: null } });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'SET_PORTAL_PIN',
        entityType: 'Student',
        entityId: student.id,
        detail: 'Portal PIN removed',
      },
      tx,
    );
  });

  return apiSuccess({ removed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/portal-links/[id]/pin', _POST as H);
export const DELETE = withApi('DELETE /api/portal-links/[id]/pin', _DELETE as H);
