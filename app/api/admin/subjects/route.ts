import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { authorize } from '@/lib/access';
import { completeLegacySubject } from '@/lib/academics/subjects';
import { CreateSubjectSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await authorize(user, 'academics.subjects.view');

  const subjects = await db.subject.findMany({
    where: { schoolId: user.schoolId },
    orderBy: { name: 'asc' },
  });

  return apiSuccess({ subjects });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorize(user, 'academics.subjects.manage');

  const parsed = await parseBody(req, CreateSubjectSchema);
  if ('error' in parsed) return parsed.error;
  const { name, code, maxMark, type } = parsed.data;

  const existing = await db.subject.findFirst({
    where: { schoolId: user.schoolId, code },
  });
  if (existing) return apiError(`A subject with code "${code}" already exists`, 409);

  const subject = await db.subject.create({
    data: {
      schoolId: user.schoolId,
      name,
      code,
      ...(maxMark !== undefined ? { maxMark } : {}),
      ...(type !== undefined ? { type } : {}),
    },
  });

  // The Academics module needs a department and the forms that offer it.
  await completeLegacySubject({ id: user.id, schoolId: user.schoolId }, subject.id);

  return apiSuccess({ subject }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/subjects',  _GET  as H);
export const POST = withApi('POST /api/admin/subjects', _POST as H);
