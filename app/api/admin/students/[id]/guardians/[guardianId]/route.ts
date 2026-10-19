import { auth } from '@/lib/auth';
import { apiSuccess, apiUnauthorized, apiValidationError, withApi } from '@/lib/api';
import { requirePermission } from '@/lib/access';
import { GuardianDetailsSchema, UpdateGuardianLinkSchema } from '@/lib/validations/academic';
import { setPrimaryGuardian, unlinkGuardian, updateGuardian, updateLink } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';

type Ctx = { params: { id: string; guardianId: string } };

async function currentUser() {
  const s = await auth();
  if (!s?.user?.id) return null;
  const user = s.user as unknown as SessionUser;
  await requirePermission('students.guardians.edit');
  return user;
}

// Body { link: {...} } changes the relationship/flags or makes the guardian
// primary; body { guardian: {...} } edits the guardian's own details.
async function _PATCH(req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return apiUnauthorized();

  const body = await req.json().catch(() => ({})) as { link?: unknown; guardian?: unknown };
  const guardian = body.guardian ? GuardianDetailsSchema.partial().safeParse(body.guardian) : null;
  if (guardian && !guardian.success) return apiValidationError(guardian.error);
  const link = body.link ? UpdateGuardianLinkSchema.safeParse(body.link) : null;
  if (link && !link.success) return apiValidationError(link.error);

  if (guardian?.success) await updateGuardian(user.schoolId, user.id, params.guardianId, guardian.data);
  if (link?.success) {
    const { makePrimary, ...rest } = link.data;
    if (makePrimary) await setPrimaryGuardian(user.schoolId, user.id, params.id, params.guardianId);
    if (Object.keys(rest).length) await updateLink(user.schoolId, user.id, params.id, params.guardianId, rest);
  }
  return apiSuccess({ updated: true });
}

async function _DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return apiUnauthorized();
  await unlinkGuardian(user.schoolId, user.id, params.id, params.guardianId);
  return apiSuccess({ removed: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH  = withApi('PATCH /api/admin/students/[id]/guardians/[guardianId]',  _PATCH  as unknown as H);
export const DELETE = withApi('DELETE /api/admin/students/[id]/guardians/[guardianId]', _DELETE as unknown as H);
