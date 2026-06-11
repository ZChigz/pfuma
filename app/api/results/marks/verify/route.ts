import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canVerifyMarks } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { VerifyMarksSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canVerifyMarks(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, VerifyMarksSchema);
  if ('error' in parsed) return parsed.error;
  const { assignmentId, term, force } = parsed.data;

  const assignment = await prisma.subjectAssignment.findFirst({
    where: { id: assignmentId, schoolId: user.schoolId },
    include: { subject: { select: { name: true } }, class: { select: { name: true } } },
  });
  if (!assignment) return apiNotFound('Assignment');

  if (user.role === 'TEACHER' && assignment.teacherId !== user.id) {
    return apiForbidden();
  }

  if (assignment.marksStatus !== 'IN_PROGRESS' && assignment.marksStatus !== 'NOT_STARTED') {
    return apiSuccess({ verified: false, message: 'Marks have already been verified for this assignment' });
  }

  const [students, marks] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId: user.schoolId, classId: assignment.classId, active: true },
      select: { id: true, fullName: true },
    }),
    prisma.mark.findMany({
      where: { schoolId: user.schoolId, subjectId: assignment.subjectId, term, student: { classId: assignment.classId } },
      select: { studentId: true },
    }),
  ]);

  const enteredStudentIds = new Set(marks.map((m) => m.studentId));
  const missingStudents = students.filter((s) => !enteredStudentIds.has(s.id));
  const missingCount = missingStudents.length;

  if (missingCount > 0 && force !== true) {
    return apiSuccess({
      requiresConfirmation: true,
      missingCount,
      missingStudents: missingStudents.map((s) => s.fullName),
      message: `${missingCount} student${missingCount !== 1 ? 's' : ''} have no mark entered. Submit anyway?`,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();

    await tx.mark.updateMany({
      where: { schoolId: user.schoolId, subjectId: assignment.subjectId, term, status: 'DRAFT', student: { classId: assignment.classId } },
      data: { status: 'VERIFIED', verifiedAt: now },
    });

    await tx.subjectAssignment.update({
      where: { id: assignment.id },
      data: { marksStatus: 'VERIFIED', marksVerifiedAt: now, marksVerifiedById: user.id },
    });

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'VERIFY_MARKS',
        entityType: 'SubjectAssignment',
        entityId:   assignment.id,
        detail:     `Verified marks for ${assignment.subject.name} — ${assignment.class.name} (${term})`,
      },
      tx,
    );

    return marks.length;
  });

  return apiSuccess({ verified: true, marksCount: result });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/marks/verify', _POST as H);
