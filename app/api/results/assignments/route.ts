import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { canManageSubjects } from '@/lib/permissions';
import { AssignTeacherSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const where =
    user.role === 'TEACHER'
      ? { schoolId: user.schoolId, teacherId: user.id }
      : { schoolId: user.schoolId };

  const assignments = await prisma.subjectAssignment.findMany({
    where,
    include: {
      subject: { select: { id: true, name: true, code: true, grade: true, maxMark: true } },
      teacher: { select: { id: true, fullName: true } },
    },
    orderBy: [{ subject: { grade: 'asc' } }, { subject: { name: 'asc' } }, { term: 'desc' }],
  });

  return apiSuccess({ assignments });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageSubjects(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, AssignTeacherSchema);
  if ('error' in parsed) return parsed.error;
  const { teacherId, subjectId, term } = parsed.data;

  const teacher = await prisma.user.findUnique({ where: { id: teacherId } });
  if (!teacher || teacher.schoolId !== user.schoolId) {
    return apiError('Teacher not found in this school', 404);
  }

  const assignment = await prisma.$transaction(async (tx) => {
    return tx.subjectAssignment.upsert({
      where: { teacherId_subjectId_term: { teacherId, subjectId, term } },
      update: {},
      create: { schoolId: user.schoolId, teacherId, subjectId, term },
    });
  });

  return apiSuccess({ assignment }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/assignments', _POST as H);
