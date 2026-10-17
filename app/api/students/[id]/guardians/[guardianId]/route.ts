import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, parseBody, withApi } from '@/lib/api';
import { loadReachable } from '@/lib/students/common';
import { setPrimaryGuardian, unlinkGuardian, updateGuardian, updateLink } from '@/lib/students/guardians';
import { getScopedDb } from '@/lib/scoped-db';
import { mobilePhone, normalizeName, RELATIONSHIPS } from '@/lib/students/registration';

const Body = z.object({
  guardian: z.object({
    fullName: z.string().trim().min(3).max(100).optional(),
    phone: z.string().optional(),
    altPhone: z.string().nullable().optional(),
    email: z.string().trim().max(100).nullable().optional(),
    nationalId: z.string().trim().max(20).nullable().optional(),
    occupation: z.string().trim().max(60).nullable().optional(),
    address: z.string().trim().max(200).nullable().optional(),
  }).optional(),
  link: z.object({
    relationship: z.enum(RELATIONSHIPS).optional(),
    relationshipNote: z.string().trim().max(30).nullable().optional(),
    makePrimary: z.literal(true).optional(),
    isFeePayer: z.boolean().optional(),
    receivesSms: z.boolean().optional(),
    canCollect: z.boolean().optional(),
    custodyNote: z.string().trim().max(200).nullable().optional(),
  }).optional(),
});

async function guarded(studentId: string, user: Awaited<ReturnType<typeof requirePermission>>) {
  await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } });
    await loadReachable(tx, user, [studentId], open?.id);
  });
}

// Change a guardian's details or how they are linked to this student (primary, fee payer, SMS, may collect, custody note).
async function _PATCH(req: Request, ctx?: unknown) {
  const user = await requirePermission('students.guardians.edit');
  const { id, guardianId } = (ctx as { params: { id: string; guardianId: string } }).params;
  const body = await parseBody(req, Body);
  if ('error' in body) return body.error;
  await guarded(id, user);
  const { guardian, link } = body.data;
  if (guardian) {
    const data: Record<string, string | null> = {};
    if (guardian.fullName) data.fullName = normalizeName(guardian.fullName);
    if (guardian.phone) {
      const p = mobilePhone('Phone', true).safeParse(guardian.phone);
      if (!p.success) return Response.json({ success: false, message: 'Please fix the highlighted fields', errors: { phone: ['Enter a Zimbabwean mobile number such as 0771234567'] } }, { status: 422 });
      data.phone = p.data!;
    }
    if (guardian.altPhone !== undefined) data.altPhone = guardian.altPhone ? mobilePhone('Phone', false).parse(guardian.altPhone) : null;
    if (guardian.email !== undefined) data.email = guardian.email ? guardian.email.toLowerCase() : null;
    if (guardian.nationalId !== undefined) data.nationalId = guardian.nationalId ? guardian.nationalId.toUpperCase() : null;
    if (guardian.occupation !== undefined) data.occupation = guardian.occupation || null;
    if (guardian.address !== undefined) data.address = guardian.address || null;
    await updateGuardian(user.schoolId, user.id, guardianId, data as never);
  }
  if (link) {
    const { makePrimary, receivesSms, ...rest } = link;
    if (makePrimary) await setPrimaryGuardian(user.schoolId, user.id, id, guardianId);
    const data = { ...rest, ...(receivesSms !== undefined ? { canReceiveSms: receivesSms } : {}) };
    if (Object.keys(data).length) await updateLink(user.schoolId, user.id, id, guardianId, data);
  }
  return apiSuccess({ updated: true });
}

// Unlink a guardian from this student. A student keeps at least one guardian, and the primary cannot be removed.
async function _DELETE(_req: Request, ctx?: unknown) {
  const user = await requirePermission('students.guardians.edit');
  const { id, guardianId } = (ctx as { params: { id: string; guardianId: string } }).params;
  await guarded(id, user);
  await unlinkGuardian(user.schoolId, user.id, id, guardianId);
  return apiSuccess({ unlinked: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/students/[id]/guardians/[guardianId]', _PATCH as H);
export const DELETE = withApi('DELETE /api/students/[id]/guardians/[guardianId]', _DELETE as H);
