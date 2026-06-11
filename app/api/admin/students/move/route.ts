import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { MoveStudentsSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, MoveStudentsSchema);
  if ('error' in parsed) return parsed.error;
  const { studentIds, classId } = parsed.data;

  const schoolClass = await prisma.schoolClass.findUnique({ where: { id: classId } });
  if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiError('Class not found', 404);

  const moved = await prisma.$transaction(async (tx) => {
    const result = await tx.student.updateMany({
      where: { id: { in: studentIds }, schoolId: user.schoolId },
      data: { classId: schoolClass.id, grade: schoolClass.grade },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'MOVE_STUDENT',
        entityType: 'SchoolClass',
        entityId:   schoolClass.id,
        detail:     `Moved ${result.count} student(s) to ${schoolClass.name}`,
      },
      tx,
    );
    return result.count;
  });

  return apiSuccess({ moved });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/move', _POST as H);
