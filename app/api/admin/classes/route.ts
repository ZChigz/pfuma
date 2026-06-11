import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageClasses } from '@/lib/permissions';
import { CreateClassSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET() {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const classes = await prisma.schoolClass.findMany({
    where: { schoolId: user.schoolId },
    include: {
      classTeacher: { select: { id: true, fullName: true } },
      _count: { select: { students: true } },
    },
    orderBy: [{ grade: 'asc' }, { section: 'asc' }],
  });

  return apiSuccess({
    classes: classes.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      section: c.section,
      active: c.active,
      classTeacher: c.classTeacher,
      studentCount: c._count.students,
    })),
  });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateClassSchema);
  if ('error' in parsed) return parsed.error;
  const { grade, section, classTeacherId } = parsed.data;

  const name = section ? `${grade}${section}` : grade;

  const existing = await prisma.schoolClass.findFirst({
    where: { schoolId: user.schoolId, name },
  });
  if (existing) return apiError(`A class named "${name}" already exists`, 409);

  if (classTeacherId) {
    const teacher = await prisma.user.findUnique({ where: { id: classTeacherId } });
    if (!teacher || teacher.schoolId !== user.schoolId) {
      return apiError('Class teacher not found in this school', 404);
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const schoolClass = await tx.schoolClass.create({
      data: {
        schoolId: user.schoolId,
        name,
        grade,
        section: section || null,
        classTeacherId: classTeacherId || null,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_CLASS',
        entityType: 'SchoolClass',
        entityId:   schoolClass.id,
        detail:     name,
      },
      tx,
    );
    return schoolClass;
  });

  return apiSuccess({ class: created }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/admin/classes',  _GET  as H);
export const POST = withApi('POST /api/admin/classes', _POST as H);
