import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canUnverifyMarks } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { UnverifyMarksSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canUnverifyMarks(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, UnverifyMarksSchema);
  if ('error' in parsed) return parsed.error;
  const { assignmentId } = parsed.data;

  const assignment = await prisma.subjectAssignment.findFirst({
    where: { id: assignmentId, schoolId: user.schoolId },
    include: { subject: { select: { name: true } }, class: { select: { name: true } } },
  });
  if (!assignment) return apiNotFound('Assignment');

  await prisma.$transaction(async (tx) => {
    await tx.mark.updateMany({
      where: {
        schoolId:  user.schoolId,
        subjectId: assignment.subjectId,
        term:      assignment.term,
        status:    'VERIFIED',
        student:   { classId: assignment.classId },
      },
      data: { status: 'DRAFT', verifiedAt: null },
    });

    await tx.subjectAssignment.update({
      where: { id: assignment.id },
      data: { marksStatus: 'IN_PROGRESS', marksVerifiedAt: null, marksVerifiedById: null },
    });

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UNVERIFY_MARKS',
        entityType: 'SubjectAssignment',
        entityId:   assignment.id,
        detail:     `Unlocked marks for ${assignment.subject.name} — ${assignment.class.name} (${assignment.term})`,
      },
      tx,
    );
  });

  return apiSuccess({ message: 'Marks unlocked for teacher editing' });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/marks/unverify', _POST as H);
