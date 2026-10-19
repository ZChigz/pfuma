import { z } from 'zod';
import { requirePermission } from '@/lib/access';
import { apiSuccess, withApi } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { createResetLink, resetUserPassword } from '@/lib/system/users';

// The default sends a reset link (valid 30 minutes, one use) for the administrator to pass on. A temporary
// password can still be asked for with { "method": "TEMP_PASSWORD" } when the person has no phone or e-mail at hand.
const BodySchema = z.object({ method: z.enum(['LINK', 'TEMP_PASSWORD']).default('LINK') });

async function _POST(req: Request, ctx: { params: { id: string } }) {
  const user = await requirePermission('system.users.edit');
  const db = getScopedDb(user.schoolId, user.id);
  const raw = await req.json().catch(() => ({}));
  const { method } = BodySchema.parse(raw && typeof raw === 'object' ? raw : {});
  if (method === 'TEMP_PASSWORD') return apiSuccess({ method, ...(await resetUserPassword(db, user, ctx.params.id)) });
  const { url, expiresAt } = await createResetLink(db, user, ctx.params.id);
  return apiSuccess({ method, reset: { url, expiresAt } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/system/users/[id]/reset-password', _POST as H);
