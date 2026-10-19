import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canManageSubjects } from '@/lib/permissions';
import { UpdateSubjectSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageSubjects(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await db.subject.findUnique({ where: { id: ctx.params.id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Subject');

  const parsed = await parseBody(req, UpdateSubjectSchema);
  if ('error' in parsed) return parsed.error;
  const { name, code, maxMark, type, active } = parsed.data;

  if (code && code !== existing.code) {
    const dup = await db.subject.findFirst({
      where: { schoolId: user.schoolId, code, id: { not: existing.id } },
    });
    if (dup) return apiError(`A subject with code "${code}" already exists`, 409);
  }

  const subject = await db.subject.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(maxMark !== undefined ? { maxMark } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  });

  return apiSuccess({ subject });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/admin/subjects/[id]', _PATCH as H);
