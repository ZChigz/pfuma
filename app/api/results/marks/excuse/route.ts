import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiNotFound, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canExcuseAbsence } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { ExcuseAbsenceSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

// An ABSENT mark counts as 0 unless the Head excuses it; an excused absence is left
// out of the student's subjects, like an exemption. Head only, with a reason. Results
// that are already published must be unpublished first so positions get recalculated.
async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canExcuseAbsence(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, ExcuseAbsenceSchema);
  if ('error' in parsed) return parsed.error;
  const { markId, excused, reason } = parsed.data;

  const mark = await db.mark.findFirst({
    where: { id: markId, schoolId: user.schoolId },
    include: { student: { select: { fullName: true } }, subject: { select: { name: true } }, term: { select: { name: true, status: true } } },
  });
  if (!mark) return apiNotFound('Mark');
  if (mark.status !== 'ABSENT') return apiError('Only an absence can be excused', 409);
  if (mark.term.status === 'CLOSED') return apiError(`${mark.term.name} is closed, so its results are locked. The Director can reopen the term.`, 409);

  const enrollment = await db.enrollment.findUnique({ where: { studentId_termId: { studentId: mark.studentId, termId: mark.termId } } });
  const assignment = enrollment
    ? await db.subjectAssignment.findFirst({ where: { schoolId: user.schoolId, subjectId: mark.subjectId, classId: enrollment.classId, termId: mark.termId } })
    : null;
  if (assignment?.marksStatus === 'PUBLISHED') {
    return apiError('These results are published. Unpublish the class results first, then excuse the absence and publish again.', 409);
  }

  await db.$tx(async (tx) => {
    await tx.mark.update({ where: { id: mark.id }, data: { excused } });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'EXCUSE_ABSENCE',
        entityType: 'Mark',
        entityId:   mark.id,
        detail:     `${excused ? 'Excused' : 'Un-excused'} ${mark.student.fullName}'s absence in ${mark.subject.name} (${mark.term.name}). Reason: ${reason}`,
      },
      tx,
    );
  });

  return apiSuccess({ excused });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/marks/excuse', _POST as H);
