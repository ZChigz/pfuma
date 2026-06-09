import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, apiForbidden, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canEnterMarks } from '@/lib/permissions';
import { EnterMarkSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
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

  const [marks, subject] = await Promise.all([
    prisma.mark.findMany({
      where: { schoolId: user.schoolId, subjectId, term },
      include: { student: { select: { fullName: true, grade: true } } },
      orderBy: { student: { fullName: 'asc' } },
    }),
    prisma.subject.findFirst({
      where: { id: subjectId, schoolId: user.schoolId },
      select: { grade: true },
    }),
  ]);

  // Check if the grade-term combination is published
  let published = false;
  if (subject) {
    const count = await prisma.termResult.count({
      where: {
        schoolId: user.schoolId,
        term,
        published: true,
        student: { grade: subject.grade },
      },
    });
    published = count > 0;
  }

  return apiSuccess({
    marks: marks.map((m) => ({
      ...m,
      rawMark:    m.rawMark.toNumber(),
      percentage: m.percentage?.toNumber() ?? null,
    })),
    published,
  });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canEnterMarks(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, EnterMarkSchema);
  if ('error' in parsed) return parsed.error;
  const { studentId, subjectId, term, rawMark } = parsed.data;

  // Verify subject belongs to this school and get maxMark
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, schoolId: user.schoolId },
  });
  if (!subject) return apiNotFound('Subject');

  if (rawMark > subject.maxMark) {
    return apiError(`Mark cannot exceed maximum of ${subject.maxMark}`, 422);
  }

  // If TEACHER, verify assignment
  if (user.role === 'TEACHER') {
    const assignment = await prisma.subjectAssignment.findFirst({
      where: { schoolId: user.schoolId, teacherId: user.id, subjectId, term },
    });
    if (!assignment) return apiForbidden();
  }

  // Block if term results are already published for this student
  const termResult = await prisma.termResult.findUnique({
    where: { studentId_term: { studentId, term } },
  });
  if (termResult?.published) {
    return apiError('Results are published and locked for this term', 403);
  }

  // Compute letter grade
  const percentage = subject.maxMark > 0 ? (rawMark / subject.maxMark) * 100 : 0;
  const boundary = await prisma.gradeBoundary.findFirst({
    where: {
      schoolId: user.schoolId,
      minPercent: { lte: percentage },
      maxPercent: { gte: percentage },
    },
  });
  const letterGrade = boundary?.letterGrade ?? null;

  const mark = await prisma.mark.upsert({
    where: { studentId_subjectId_term: { studentId, subjectId, term } },
    update: {
      rawMark,
      percentage,
      letterGrade,
      enteredBy: user.id,
      enteredAt: new Date(),
    },
    create: {
      schoolId: user.schoolId,
      studentId,
      subjectId,
      term,
      rawMark,
      percentage,
      letterGrade,
      enteredBy: user.id,
    },
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
export const GET  = withApi('GET /api/results/marks',  _GET  as H);
export const POST = withApi('POST /api/results/marks', _POST as H);
