import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canManageSubjects } from '@/lib/permissions';
import { CreateAssignmentSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = new URL(req.url);
  const classId   = searchParams.get('classId')   ?? undefined;
  const teacherId = searchParams.get('teacherId') ?? undefined;
  const term      = searchParams.get('term')      ?? undefined;

  const assignments = await prisma.subjectAssignment.findMany({
    where: {
      schoolId: user.schoolId,
      ...(classId   ? { classId }   : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(term      ? { term }      : {}),
    },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
      teacher: { select: { id: true, fullName: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }, { term: 'desc' }],
  });

  return apiSuccess({ assignments });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageSubjects(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateAssignmentSchema);
  if ('error' in parsed) return parsed.error;
  const { teacherId, subjectId, classId, term } = parsed.data;

  const [teacher, subject, schoolClass] = await Promise.all([
    prisma.user.findUnique({ where: { id: teacherId } }),
    prisma.subject.findUnique({ where: { id: subjectId } }),
    prisma.schoolClass.findUnique({ where: { id: classId } }),
  ]);
  if (!teacher || teacher.schoolId !== user.schoolId) return apiError('Teacher not found in this school', 404);
  if (!subject || subject.schoolId !== user.schoolId) return apiNotFound('Subject');
  if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiNotFound('Class');

  const existing = await prisma.subjectAssignment.findUnique({
    where: { subjectId_classId_term: { subjectId, classId, term } },
  });
  if (existing) {
    return apiError(
      `${schoolClass.name} already has a teacher assigned for ${subject.name} in ${term}. Remove the existing assignment first.`,
      409,
    );
  }

  const assignment = await prisma.subjectAssignment.create({
    data: { schoolId: user.schoolId, teacherId, subjectId, classId, term },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
      teacher: { select: { id: true, fullName: true } },
    },
  });

  return apiSuccess({ assignment }, 201);
}

async function _DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageSubjects(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  let id = new URL(req.url).searchParams.get('id');
  if (!id) {
    const body = await req.json().catch(() => null) as { id?: string } | null;
    id = body?.id ?? null;
  }
  if (!id) return apiError('Assignment id is required', 400);

  const existing = await prisma.subjectAssignment.findUnique({ where: { id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Assignment');

  await prisma.subjectAssignment.delete({ where: { id } });

  return apiSuccess({ deleted: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET    = withApi('GET /api/admin/assignments',    _GET    as H);
export const POST   = withApi('POST /api/admin/assignments',   _POST   as H);
export const DELETE = withApi('DELETE /api/admin/assignments', _DELETE as H);
