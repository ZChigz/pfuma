import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canVerifyMarks } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { VerifyMarksSchema } from '@/lib/validations/results';
import { classRoster } from '@/lib/academic/roster';
import { LEGACY_MESSAGE, newExamsActive } from '@/lib/exams/legacy-guard';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canVerifyMarks(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, VerifyMarksSchema);
  if ('error' in parsed) return parsed.error;
  const { assignmentId } = parsed.data;

  const assignment = await db.subjectAssignment.findFirst({
    where: { id: assignmentId, schoolId: user.schoolId },
    include: { subject: { select: { name: true } }, class: { select: { name: true } }, term: { select: { name: true, status: true } } },
  });
  if (!assignment) return apiNotFound('Assignment');
  if (assignment.term.status === 'CLOSED') return apiError(`${assignment.term.name} is closed, so its results are locked. The Director can reopen the term.`, 409);


  if (user.role === 'TEACHER' && assignment.teacherId !== user.id) {
    return apiForbidden();
  }

  const levelOf = await db.schoolClass.findFirst({ where: { id: assignment.classId, schoolId: user.schoolId }, select: { levelId: true } });
  if (levelOf && (await newExamsActive(db, user.schoolId, levelOf.levelId, assignment.termId))) return apiError(LEGACY_MESSAGE, 409);

  if (assignment.marksStatus !== 'IN_PROGRESS' && assignment.marksStatus !== 'NOT_STARTED') {
    return apiSuccess({ verified: false, message: 'Marks have already been verified for this assignment' });
  }

  const students = await classRoster(assignment.classId, assignment.termId, db);
  const studentIds = students.map((s) => s.id);
  const marks = await db.mark.findMany({
    where: { schoolId: user.schoolId, subjectId: assignment.subjectId, termId: assignment.termId, studentId: { in: studentIds } },
    select: { studentId: true },
  });

  const enteredStudentIds = new Set(marks.map((m) => m.studentId));
  const missingStudents = students.filter((s) => !enteredStudentIds.has(s.id));
  const missingCount = missingStudents.length;

  // Every enrolled student needs a mark, ABSENT or EXEMPT before the subject can be verified.
  if (missingCount > 0) {
    const names = missingStudents.map((s) => s.fullName);
    const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '');
    return apiError(
      `${missingCount} student${missingCount !== 1 ? 's have' : ' has'} no mark: ${shown}. Enter a mark, Absent or Exempt for everyone before verifying.`,
      422,
    );
  }

  const result = await db.$tx(async (tx) => {
    const now = new Date();

    await tx.mark.updateMany({
      where: { schoolId: user.schoolId, subjectId: assignment.subjectId, termId: assignment.termId, status: 'DRAFT', studentId: { in: studentIds } },
      data: { status: 'VERIFIED', verifiedAt: now },
    });
    // Remember that these marks have been verified once; later changes need a reason.
    await tx.mark.updateMany({
      where: { schoolId: user.schoolId, subjectId: assignment.subjectId, termId: assignment.termId, status: { in: ['VERIFIED', 'ABSENT', 'EXEMPT'] }, firstVerifiedAt: null, studentId: { in: studentIds } },
      data: { firstVerifiedAt: now },
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
        detail:     `Verified marks for ${assignment.subject.name} — ${assignment.class.name} (${assignment.term.name})`,
      },
      tx,
    );

    return marks.length;
  });

  return apiSuccess({ verified: true, marksCount: result });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/marks/verify', _POST as H);
