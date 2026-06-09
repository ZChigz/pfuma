import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  apiSuccess, apiUnauthorized, apiError, apiForbidden, apiNotFound, parseBody,
} from '@/lib/api';
import { canEnterMarksSync } from '@/lib/permissions';
import { EnterMarkSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId');
  const term      = searchParams.get('term');
  if (!subjectId || !term) return apiError('subjectId and term are required', 400);

  if (user.role === 'TEACHER') {
    const assignment = await prisma.subjectAssignment.findFirst({
      where: { schoolId: user.schoolId, teacherId: user.id, subjectId, term },
    });
    if (!assignment) return apiForbidden();
  }

  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: user.schoolId },
  });
  if (!subject) return apiNotFound('Subject');

  const [students, marks, publishedCount] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId: user.schoolId, grade: subject.grade, active: true },
      select: { id: true, fullName: true, grade: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.mark.findMany({
      where: { schoolId: user.schoolId, subjectId, term },
    }),
    prisma.termResult.count({
      where: {
        schoolId: user.schoolId,
        term,
        published: true,
        student: { grade: subject.grade },
      },
    }),
  ]);

  return apiSuccess({
    subject,
    students,
    marks: marks.map((m) => ({
      ...m,
      rawMark:    m.rawMark.toNumber(),
      percentage: m.percentage?.toNumber() ?? null,
    })),
    isPublished: publishedCount > 0,
    term,
  });
}

export async function POST(req: Request) {
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
  const { studentId, subjectId, term, rawMark } = parsed.data;

  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: user.schoolId },
  });
  if (!subject) return apiNotFound('Subject');

  if (rawMark > subject.maxMark) {
    return apiError(`Mark cannot exceed maximum of ${subject.maxMark}`, 422);
  }

  if (user.role === 'TEACHER') {
    const assignment = await prisma.subjectAssignment.findFirst({
      where: { schoolId: user.schoolId, teacherId: user.id, subjectId, term },
    });
    if (!assignment) return apiForbidden();
  }

  const termResult = await prisma.termResult.findUnique({
    where: { studentId_term: { studentId, term } },
  });
  if (termResult?.published) {
    return apiError('Results are published and locked for this term', 403);
  }

  const percentage = subject.maxMark > 0 ? (rawMark / subject.maxMark) * 100 : 0;
  const boundary = await prisma.gradeBoundary.findFirst({
    where: {
      schoolId:   user.schoolId,
      minPercent: { lte: percentage },
      maxPercent: { gte: percentage },
    },
  });
  const letterGrade = boundary?.letterGrade ?? null;

  const mark = await prisma.mark.upsert({
    where: { studentId_subjectId_term: { studentId, subjectId, term } },
    update: { rawMark, percentage, letterGrade, enteredBy: user.id, enteredAt: new Date() },
    create: { schoolId: user.schoolId, studentId, subjectId, term, rawMark, percentage, letterGrade, enteredBy: user.id },
  });

  return apiSuccess({
    mark: {
      ...mark,
      rawMark:    mark.rawMark.toNumber(),
      percentage: mark.percentage?.toNumber() ?? null,
    },
  });
}
