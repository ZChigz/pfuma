import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canPublishResults } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { PublishResultsSchema } from '@/lib/validations/results';
import { assignPositions, getLetterGrade } from '@/lib/results';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canPublishResults(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, PublishResultsSchema);
  if ('error' in parsed) return parsed.error;
  const { classId, term } = parsed.data;

  const schoolClass = await prisma.schoolClass.findFirst({
    where: { id: classId, schoolId: user.schoolId },
  });
  if (!schoolClass) return apiNotFound('Class');

  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, classId, term },
    include: { subject: { select: { id: true, name: true, maxMark: true } } },
  });

  if (assignments.length === 0) {
    return apiError('No subjects are assigned to this class for this term', 400);
  }

  const notVerified = assignments.filter((a) => a.marksStatus !== 'VERIFIED');
  if (notVerified.length > 0) {
    return apiError(
      `${notVerified.length} subject(s) not yet verified by teacher: ${notVerified.map((a) => a.subject.name).join(', ')}`,
      400,
    );
  }

  const [students, boundaryRows] = await Promise.all([
    prisma.student.findMany({
      where: { schoolId: user.schoolId, classId, active: true },
      select: { id: true, fullName: true },
    }),
    prisma.gradeBoundary.findMany({ where: { schoolId: user.schoolId } }),
  ]);

  const boundaries = boundaryRows.map((b) => ({
    minPercent:  b.minPercent.toNumber(),
    maxPercent:  b.maxPercent.toNumber(),
    letterGrade: b.letterGrade,
  }));

  const totalPossible = assignments.reduce((n, a) => n + a.subject.maxMark, 0);

  const subjectIds = assignments.map((a) => a.subjectId);
  const allMarks = await prisma.mark.findMany({
    where: {
      schoolId:  user.schoolId,
      subjectId: { in: subjectIds },
      term,
      status:    'VERIFIED',
      student:   { classId },
    },
  });

  const summaries = students.map((s) => {
    const subjectMarks = allMarks.filter((m) => m.studentId === s.id);
    const totalMarks = subjectMarks.reduce((n, m) => n + m.rawMark.toNumber(), 0);
    const percentage = totalPossible > 0 ? (totalMarks / totalPossible) * 100 : 0;
    const letterGrade = getLetterGrade(percentage, boundaries);
    return { studentId: s.id, fullName: s.fullName, totalMarks, percentage, letterGrade };
  });

  summaries.sort((a, b) => b.totalMarks - a.totalMarks);
  const positions = assignPositions(summaries.map((s) => ({ id: s.studentId, totalMarks: s.totalMarks })));

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const s of summaries) {
      await tx.termResult.upsert({
        where:  { studentId_term: { studentId: s.studentId, term } },
        update: {
          totalMarks:    s.totalMarks,
          percentage:    s.percentage,
          classPosition: positions.get(s.studentId) ?? null,
          published:     true,
          publishedAt:   now,
        },
        create: {
          schoolId:      user.schoolId,
          studentId:     s.studentId,
          term,
          totalMarks:    s.totalMarks,
          percentage:    s.percentage,
          classPosition: positions.get(s.studentId) ?? null,
          published:     true,
          publishedAt:   now,
        },
      });
    }

    await tx.mark.updateMany({
      where: {
        schoolId:  user.schoolId,
        subjectId: { in: subjectIds },
        term,
        status:    'VERIFIED',
        student:   { classId },
      },
      data: { status: 'PUBLISHED' },
    });

    await tx.subjectAssignment.updateMany({
      where: { schoolId: user.schoolId, classId, term },
      data: { marksStatus: 'PUBLISHED' },
    });

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'PUBLISH_RESULTS',
        entityType: 'TermResult',
        entityId:   `${classId}:${term}`,
        detail:     `Published ${summaries.length} results for ${schoolClass.name} — ${term}`,
      },
      tx,
    );
  });

  const classAverage = summaries.length > 0
    ? summaries.reduce((n, s) => n + s.percentage, 0) / summaries.length
    : 0;

  return apiSuccess({
    published:    summaries.length,
    topStudent:   summaries[0]?.fullName ?? null,
    classAverage,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/publish', _POST as H);
