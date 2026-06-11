import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { CreateAdminStudentSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const classId = searchParams.get('classId') || undefined;
  const grade   = searchParams.get('grade')   || undefined;

  const students = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      ...(classId ? { classId } : {}),
      ...(grade ? { grade } : {}),
    },
    include: {
      class: { select: { id: true, name: true, grade: true, section: true } },
    },
    orderBy: { fullName: 'asc' },
  });

  return apiSuccess({ students });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateAdminStudentSchema);
  if ('error' in parsed) return parsed.error;
  const { fullName, classId, parentName, parentPhone } = parsed.data;

  const schoolClass = await prisma.schoolClass.findUnique({ where: { id: classId } });
  if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiError('Class not found', 404);

  const student = await prisma.$transaction(async (tx) => {
    const s = await tx.student.create({
      data: {
        schoolId: user.schoolId,
        fullName,
        grade: schoolClass.grade,
        classId: schoolClass.id,
        parentName,
        parentPhone,
        portalToken: crypto.randomUUID(),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_STUDENT',
        entityType: 'Student',
        entityId:   s.id,
        detail:     `${fullName} — ${schoolClass.name}`,
      },
      tx,
    );
    return s;
  });

  return apiSuccess({ student }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/students',  _GET  as unknown as H);
export const POST = withApi('POST /api/admin/students', _POST as H);
