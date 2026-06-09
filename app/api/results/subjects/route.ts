import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canManageSubjects } from '@/lib/permissions';
import { CreateSubjectSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const grade = new URL(req.url).searchParams.get('grade') ?? undefined;

  const subjects = await prisma.subject.findMany({
    where: { schoolId: user.schoolId, ...(grade ? { grade } : {}) },
    include: {
      assignments: {
        include: { teacher: { select: { id: true, fullName: true } } },
        orderBy: { term: 'desc' },
      },
    },
    orderBy: [{ grade: 'asc' }, { type: 'asc' }, { name: 'asc' }],
  });

  return apiSuccess({ subjects });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageSubjects(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateSubjectSchema);
  if ('error' in parsed) return parsed.error;

  const subject = await prisma.subject.create({
    data: { ...parsed.data, schoolId: user.schoolId },
  });

  return apiSuccess({ subject }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/results/subjects',  _GET  as H);
export const POST = withApi('POST /api/results/subjects', _POST as H);
