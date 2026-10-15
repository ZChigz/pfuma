import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canPublishResults } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { PublishResultsSchema } from '@/lib/validations/results';
import { assignPositions, getLetterGrade, summariseStudent, type OfferedSubject } from '@/lib/results';
import { requireTerm } from '@/lib/academic/terms';
import { classRoster } from '@/lib/academic/roster';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canPublishResults(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, PublishResultsSchema);
  if ('error' in parsed) return parsed.error;
  const { classId, termId } = parsed.data;

  const schoolClass = await db.schoolClass.findFirst({
    where: { id: classId, schoolId: user.schoolId },
  });
  if (!schoolClass) return apiNotFound('Class');
  const termRow = await requireTerm(user.schoolId, termId, db);
  const term = termRow.name;

  const assignments = await db.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, classId, termId },
    include: { subject: { select: { id: true, name: true, maxMark: true, type: true } } },
  });

  if (assignments.length === 0) {
    return apiError('No subjects are assigned to this class for this term', 400);
  }

  if (assignments.every((a) => a.marksStatus === 'PUBLISHED')) {
    return apiError('These results are already published. To correct them, reopen the results first.', 409);
  }

  const notVerified = assignments.filter((a) => a.marksStatus !== 'VERIFIED');
  if (notVerified.length > 0) {
    return apiError(
      `${notVerified.length} subject(s) not yet verified by teacher: ${notVerified.map((a) => a.subject.name).join(', ')}`,
      400,
    );
  }

  // Positions are among the students enrolled in this class for this term.
  const [students, boundaryRows] = await Promise.all([
    classRoster(classId, termId, db),
    db.gradeBoundary.findMany({ where: { schoolId: user.schoolId } }),
  ]);
  const studentIds = students.map((s) => s.id);

  const boundaries = boundaryRows.map((b) => ({
    minPercent:  b.minPercent.toNumber(),
    maxPercent:  b.maxPercent.toNumber(),
    letterGrade: b.letterGrade,
  }));

  const offered: OfferedSubject[] = assignments.map((a) => ({
    id: a.subjectId,
    maxMark: a.subject.maxMark,
    core: a.subject.type === 'CORE',
  }));

  const subjectIds = assignments.map((a) => a.subjectId);
  const allMarks = await db.mark.findMany({
    where: {
      schoolId:  user.schoolId,
      subjectId: { in: subjectIds },
      termId,
      status:    'VERIFIED',
      studentId: { in: studentIds },
    },
  });

  // Fair ranking: average % over the subjects each student actually sat; a student
  // who sat too few subjects is not ranked (see lib/results.ts).
  const summaries = students.map((s) => {
    const sat = allMarks
      .filter((m) => m.studentId === s.id)
      .map((m) => ({ subjectId: m.subjectId, rawMark: m.rawMark.toNumber() }));
    const summary = summariseStudent(sat, offered);
    const letterGrade = getLetterGrade(summary.percentage, boundaries);
    return { studentId: s.id, fullName: s.fullName, letterGrade, ...summary };
  });

  const positions = assignPositions(summaries.map((s) => ({ id: s.studentId, percentage: s.percentage, ranked: s.ranked })));
  const rankedOutOf = positions.size;
  summaries.sort((a, b) => (positions.get(a.studentId) ?? Infinity) - (positions.get(b.studentId) ?? Infinity) || b.percentage - a.percentage);

  const now = new Date();

  await db.$tx(async (tx) => {
    for (const s of summaries) {
      await tx.termResult.upsert({
        where:  { studentId_termId: { studentId: s.studentId, termId } },
        update: {
          totalMarks:    s.totalMarks,
          percentage:    s.percentage,
          classPosition: positions.get(s.studentId) ?? null,
          subjectsSat:     s.subjectsSat,
          subjectsOffered: s.subjectsOffered,
          rankedOutOf,
          published:     true,
          publishedAt:   now,
        },
        create: {
          schoolId:      user.schoolId,
          studentId:     s.studentId,
          termId,
          totalMarks:    s.totalMarks,
          percentage:    s.percentage,
          classPosition: positions.get(s.studentId) ?? null,
          subjectsSat:     s.subjectsSat,
          subjectsOffered: s.subjectsOffered,
          rankedOutOf,
          published:     true,
          publishedAt:   now,
        },
      });
    }

    await tx.mark.updateMany({
      where: {
        schoolId:  user.schoolId,
        subjectId: { in: subjectIds },
        termId,
        status:    'VERIFIED',
        studentId: { in: studentIds },
      },
      data: { status: 'PUBLISHED' },
    });

    await tx.subjectAssignment.updateMany({
      where: { schoolId: user.schoolId, classId, termId },
      data: { marksStatus: 'PUBLISHED' },
    });

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'PUBLISH_RESULTS',
        entityType: 'TermResult',
        entityId:   `${classId}:${termId}`,
        detail:     `Published ${summaries.length} results for ${schoolClass.name} — ${term} (${rankedOutOf} ranked, ${summaries.length - rankedOutOf} not ranked)`,
      },
      tx,
    );
  });

  const classAverage = summaries.length > 0
    ? summaries.reduce((n, s) => n + s.percentage, 0) / summaries.length
    : 0;

  return apiSuccess({
    published:    summaries.length,
    ranked:       rankedOutOf,
    notRanked:    summaries.length - rankedOutOf,
    topStudent:   rankedOutOf > 0 ? summaries[0]?.fullName ?? null : null,
    classAverage,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/publish', _POST as H);
