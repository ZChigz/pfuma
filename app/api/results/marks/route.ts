import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  apiSuccess, apiUnauthorized, apiError, apiForbidden, apiNotFound, parseBody, withApi,
} from '@/lib/api';
import { canEnterMarksSync } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { EnterMarkSchema } from '@/lib/validations/results';
import { getLetterGrade } from '@/lib/results';
import { requireTerm } from '@/lib/academic/terms';
import { classRoster } from '@/lib/academic/roster';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = new URL(req.url);
  const classId   = searchParams.get('classId');
  const subjectId = searchParams.get('subjectId');
  const termId    = searchParams.get('termId');
  if (!classId || !subjectId || !termId) return apiError('classId, subjectId and termId are required', 400);

  const [schoolClass, subject, term] = await Promise.all([
    prisma.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId } }),
    prisma.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } }),
    requireTerm(user.schoolId, termId),
  ]);
  if (!schoolClass) return apiNotFound('Class');
  if (!subject) return apiNotFound('Subject');

  const assignment = await prisma.subjectAssignment.findFirst({
    where: { schoolId: user.schoolId, subjectId, classId, termId: term.id },
  });
  if (!assignment) return apiNotFound('Assignment');
  if (user.role === 'TEACHER' && assignment.teacherId !== user.id) {
    return apiError('You are not assigned to this subject for this class', 403);
  }

  const students = await classRoster(classId, term.id);
  const marks = await prisma.mark.findMany({
    where: { schoolId: user.schoolId, subjectId, termId: term.id, studentId: { in: students.map((s) => s.id) } },
  });

  return apiSuccess({
    students,
    marks: marks.map((m) => ({
      ...m,
      rawMark:    m.rawMark.toNumber(),
      percentage: m.percentage?.toNumber() ?? null,
    })),
    subject,
    termName: term.name,
    assignment: {
      id:              assignment.id,
      marksStatus:     assignment.marksStatus,
      marksVerifiedAt: assignment.marksVerifiedAt,
    },
    isVerified:  assignment.marksStatus === 'VERIFIED',
    isPublished: assignment.marksStatus === 'PUBLISHED',
  });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try {
    canEnterMarksSync(user.role);
  } catch (e) {
    return e as Response;
  }

  const parsed = await parseBody(req, EnterMarkSchema);
  if ('error' in parsed) return parsed.error;
  const { studentId, subjectId, classId, termId, rawMark } = parsed.data;

  const subject = await prisma.subject.findFirst({ where: { id: subjectId, schoolId: user.schoolId } });
  if (!subject) return apiNotFound('Subject');
  if (rawMark < 0 || rawMark > subject.maxMark) {
    return apiError(`Mark must be between 0 and ${subject.maxMark}`, 422);
  }

  const term = await requireTerm(user.schoolId, termId);
  if (term.status === 'CLOSED') return apiError(`${term.name} is closed — marks can no longer be entered`, 409);

  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId: user.schoolId } });
  if (!student) return apiNotFound('Student');

  // The student must have been in this class for this term.
  const enrollment = await prisma.enrollment.findUnique({ where: { studentId_termId: { studentId, termId: term.id } } });
  if (!enrollment || enrollment.classId !== classId) {
    return apiError(`${student.fullName} is not in this class for ${term.name}`, 422);
  }

  const assignment = await prisma.subjectAssignment.findFirst({
    where: { schoolId: user.schoolId, subjectId, classId, termId: term.id },
  });
  if (!assignment) return apiNotFound('Assignment');

  if (user.role === 'TEACHER' && assignment.teacherId !== user.id) {
    return apiForbidden();
  }

  if (assignment.marksStatus === 'VERIFIED' || assignment.marksStatus === 'PUBLISHED') {
    return apiError('Marks are locked. Ask the Head to unlock them.', 403);
  }

  const percentage = subject.maxMark > 0 ? (rawMark / subject.maxMark) * 100 : 0;
  const boundaries = await prisma.gradeBoundary.findMany({ where: { schoolId: user.schoolId } });
  const letterGrade = getLetterGrade(
    percentage,
    boundaries.map((b) => ({ minPercent: b.minPercent.toNumber(), maxPercent: b.maxPercent.toNumber(), letterGrade: b.letterGrade })),
  );

  const mark = await prisma.$transaction(async (tx) => {
    const m = await tx.mark.upsert({
      where: { studentId_subjectId_termId: { studentId, subjectId, termId: term.id } },
      update: { rawMark, percentage, letterGrade, status: 'DRAFT', enteredBy: user.id, enteredAt: new Date() },
      create: { schoolId: user.schoolId, studentId, subjectId, termId: term.id, rawMark, percentage, letterGrade, status: 'DRAFT', enteredBy: user.id },
    });

    if (assignment.marksStatus === 'NOT_STARTED') {
      await tx.subjectAssignment.update({
        where: { id: assignment.id },
        data: { marksStatus: 'IN_PROGRESS' },
      });
    }

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'RECORD_MARK',
        entityType: 'Mark',
        entityId:   m.id,
        detail:     `Recorded mark ${rawMark}/${subject.maxMark} for ${student.fullName} in ${subject.name} (${term.name})`,
      },
      tx,
    );

    return m;
  });

  return apiSuccess({
    mark: {
      ...mark,
      rawMark:    mark.rawMark.toNumber(),
      percentage: mark.percentage?.toNumber() ?? null,
    },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/results/marks', _GET as H);
export const POST = withApi('POST /api/results/marks', _POST as H);
