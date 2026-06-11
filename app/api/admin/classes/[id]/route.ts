import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageClasses } from '@/lib/permissions';
import { UpdateClassSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const schoolClass = await prisma.schoolClass.findUnique({
    where: { id: ctx.params.id },
    include: {
      classTeacher: { select: { id: true, fullName: true } },
      students: {
        select: { id: true, fullName: true, parentName: true, parentPhone: true, active: true },
        orderBy: { fullName: 'asc' },
      },
    },
  });
  if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiNotFound('Class');

  return apiSuccess({ class: schoolClass });
}

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await prisma.schoolClass.findUnique({ where: { id: ctx.params.id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Class');

  const parsed = await parseBody(req, UpdateClassSchema);
  if ('error' in parsed) return parsed.error;
  const { grade, section, classTeacherId, active } = parsed.data;

  if (classTeacherId) {
    const teacher = await prisma.user.findUnique({ where: { id: classTeacherId } });
    if (!teacher || teacher.schoolId !== user.schoolId) {
      return apiError('Class teacher not found in this school', 404);
    }
  }

  const nextGrade   = grade   ?? existing.grade;
  const nextSection = section === undefined ? existing.section : section;
  const name = nextSection ? `${nextGrade}${nextSection}` : nextGrade;

  if (name !== existing.name) {
    const dup = await prisma.schoolClass.findFirst({
      where: { schoolId: user.schoolId, name, id: { not: existing.id } },
    });
    if (dup) return apiError(`A class named "${name}" already exists`, 409);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.schoolClass.update({
      where: { id: existing.id },
      data: {
        name,
        grade: nextGrade,
        section: nextSection,
        ...(classTeacherId !== undefined ? { classTeacherId } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_CLASS',
        entityType: 'SchoolClass',
        entityId:   c.id,
        detail:     name,
      },
      tx,
    );

    // Keep students' display grade in sync with their class's stream.
    if (nextGrade !== existing.grade) {
      await tx.student.updateMany({
        where: { classId: c.id },
        data: { grade: nextGrade },
      });
    }

    return c;
  });

  return apiSuccess({ class: updated });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/admin/classes/[id]',   _GET   as H);
export const PATCH = withApi('PATCH /api/admin/classes/[id]', _PATCH as H);
