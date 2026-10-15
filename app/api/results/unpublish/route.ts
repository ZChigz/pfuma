import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canUnpublishResults } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { UnpublishResultsSchema } from '@/lib/validations/results';
import { requireTerm } from '@/lib/academic/terms';
import { classRosterIds } from '@/lib/academic/roster';
import type { SessionUser } from '@/types';

// What happens after publishing:
//   • published results are locked: marks cannot be edited and parents see them;
//   • to correct a mistake the Head or Director REOPENS the class's results here,
//     giving a reason (audited). Parents stop seeing the term until it is
//     published again; positions are recalculated on the next publish;
//   • once the term is CLOSED the results are final and cannot be reopened.
async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canUnpublishResults(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, UnpublishResultsSchema);
  if ('error' in parsed) return parsed.error;
  const { classId, termId, reason, unlockMarks } = parsed.data;

  const schoolClass = await db.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId } });
  if (!schoolClass) return apiNotFound('Class');
  const term = await requireTerm(user.schoolId, termId, db);
  if (term.status === 'CLOSED') {
    return apiError(`${term.name} is closed, so its results are final and cannot be reopened`, 409);
  }

  const assignments = await db.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, classId, termId },
    select: { id: true, subjectId: true, marksStatus: true },
  });
  if (!assignments.some((a) => a.marksStatus === 'PUBLISHED')) {
    return apiError('There are no published results for this class and term', 409);
  }

  const studentIds = await classRosterIds(classId, termId, db);
  const subjectIds = assignments.map((a) => a.subjectId);

  await db.$tx(async (tx) => {
    const { count } = await tx.termResult.updateMany({
      where: { schoolId: user.schoolId, termId, studentId: { in: studentIds } },
      data: { published: false, publishedAt: null },
    });
    await tx.mark.updateMany({
      where: { schoolId: user.schoolId, termId, subjectId: { in: subjectIds }, studentId: { in: studentIds }, status: 'PUBLISHED' },
      data: unlockMarks ? { status: 'DRAFT', verifiedAt: null } : { status: 'VERIFIED' },
    });
    await tx.subjectAssignment.updateMany({
      where: { schoolId: user.schoolId, classId, termId, marksStatus: 'PUBLISHED' },
      data: unlockMarks
        ? { marksStatus: 'IN_PROGRESS', marksVerifiedAt: null, marksVerifiedById: null }
        : { marksStatus: 'VERIFIED' },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UNPUBLISH_RESULTS',
        entityType: 'TermResult',
        entityId:   `${classId}:${termId}`,
        detail:     `Reopened ${count} results for ${schoolClass.name} — ${term.name}${unlockMarks ? ' (marks unlocked)' : ''}. Reason: ${reason}`,
      },
      tx,
    );
  });

  return apiSuccess({ reopened: true, marksUnlocked: unlockMarks });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/unpublish', _POST as H);
