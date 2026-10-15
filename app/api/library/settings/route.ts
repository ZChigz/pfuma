import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import type { SessionUser } from '@/types';

const pick = { libraryFineLimit: true, studentLoanLimit: true, staffLoanLimit: true } as const;

const Schema = z
  .object({
    libraryFineLimit: z.number().min(0).max(100000).optional(),
    studentLoanLimit: z.number().int().min(0).max(50).optional(),
    staffLoanLimit:   z.number().int().min(0).max(50).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update' });

const out = (s: { libraryFineLimit: { toNumber(): number }; studentLoanLimit: number; staffLoanLimit: number } | null) => ({
  libraryFineLimit: s?.libraryFineLimit.toNumber() ?? 5,
  studentLoanLimit: s?.studentLoanLimit ?? 2,
  staffLoanLimit: s?.staffLoanLimit ?? 5,
});

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  return apiSuccess(out(await db.school.findUnique({ where: { id: user.schoolId }, select: pick })));
}

// Unpaid-fine limit and loan limits for students and staff.
async function _PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const parsed = await parseBody(req, Schema);
  if ('error' in parsed) return parsed.error;

  const school = await db.$tx(async (tx) => {
    const s = await tx.school.update({ where: { id: user.schoolId }, data: parsed.data, select: pick });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_LIBRARY_SETTINGS', entityType: 'School', entityId: user.schoolId,
        detail: `Fine limit ${s.libraryFineLimit.toNumber()}; loan limit students ${s.studentLoanLimit}, staff ${s.staffLoanLimit}`,
      },
      tx,
    );
    return s;
  });
  return apiSuccess(out(school));
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/library/settings', _GET as H);
export const PATCH = withApi('PATCH /api/library/settings', _PATCH as H);
