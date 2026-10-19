import { requireSignedIn } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { ProfileSchema } from '@/lib/validations/system';

// A person changes their own name, phone and photo. Email and roles are changed by an administrator.
async function _PATCH(req: Request) {
  const user = await requireSignedIn();
  const db = getScopedDb(user.schoolId, user.id);
  const parsed = await parseBody(req, ProfileSchema);
  if ('error' in parsed) return parsed.error;
  const { fullName, phone, photoUrl } = parsed.data;

  const updated = await db.$tx(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { fullName: true, phone: true, photoUrl: true } });
    const u = await tx.user.update({
      where: { id: user.id },
      data: { ...(fullName !== undefined ? { fullName } : {}), ...(phone !== undefined ? { phone } : {}), ...(photoUrl !== undefined ? { photoUrl } : {}) },
      select: { id: true, fullName: true, email: true, phone: true, photoUrl: true },
    });
    const changed = (['fullName', 'phone', 'photoUrl'] as const).filter((k) => before[k] !== u[k]);
    if (changed.length > 0) {
      await logAudit(
        {
          schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_USER', entityType: 'User', entityId: user.id,
          detail: `Changed own ${changed.map((k) => (k === 'fullName' ? 'name' : k === 'photoUrl' ? 'photo' : 'phone')).join(', ')}`,
          before: { fullName: before.fullName, phone: before.phone, photoUrl: before.photoUrl },
          after: { fullName: u.fullName, phone: u.phone, photoUrl: u.photoUrl },
        },
        tx,
      );
    }
    return u;
  });
  return apiSuccess({ user: updated });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/system/profile', _PATCH as H);
