import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiError, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { canPublishResults } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { PublishResultsSchema } from '@/lib/validations/results';
import { assignPositions, boundariesFor, getLetterGrade, gradeFor, passThreshold, summariseStudent, type OfferedSubject } from '@/lib/results';
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
    include: { level: { select: { category: true } } },
  });
  if (!schoolClass) return apiNotFound('Class');
  const termRow = await requireTerm(user.schoolId, termId, db);
  const term = termRow.name;
  if (termRow.status === 'CLOSED') return apiError(`${termRow.name} is closed, so its results are locked. The Director can reopen the term.`, 409);

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

  // The boundaries for this class's level and this term (most specific set wins).
  const boundaries = boundariesFor(
    boundaryRows.map((b) => ({
      minPercent:  b.minPercent.toNumber(),
      maxPercent:  b.maxPercent.toNumber(),
      letterGrade: b.letterGrade,
      levelId:     b.levelId,
      termId:      b.termId,
      category:    b.category,
    })),
    schoolClass.levelId,
    termId,
    schoolClass.level.category,
  );
  const nextTerm = await db.academicTerm.findFirst({
    where: { schoolId: user.schoolId, startDate: { gt: termRow.startDate } },
    orderBy: { startDate: 'asc' },
    select: { startDate: true },
  });

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
      status:    { in: ['VERIFIED', 'ABSENT', 'EXEMPT'] },
      studentId: { in: studentIds },
    },
  });

  // Overall % = average of the per-subject percentages over the subjects that count
  // (EXEMPT and excused absences left out, other absences as 0). See lib/results.ts.
  const school = await db.school.findUnique({ where: { id: user.schoolId }, select: { passGrade: true, oLevelRanking: true } });
  const passMark = passThreshold(boundaries, school?.passGrade ?? 'C');
  const mode = schoolClass.level.category === 'O_LEVEL' ? school?.oLevelRanking ?? 'AVERAGE' : 'AVERAGE';

  const summaries = students.map((s) => {
    const entries = allMarks
      .filter((m) => m.studentId === s.id)
      .map((m) => ({ subjectId: m.subjectId, rawMark: m.rawMark.toNumber(), status: m.status, excused: m.excused }));
    const summary = summariseStudent(entries, offered, passMark);
    const letterGrade = getLetterGrade(summary.averagePercentage, boundaries);
    return { studentId: s.id, fullName: s.fullName, letterGrade, ...summary };
  });

  const positions = assignPositions(
    summaries.map((s) => ({ id: s.studentId, averagePercentage: s.averagePercentage, subjectsPassed: s.subjectsPassed, ranked: s.ranked })),
    mode,
  );
  const rankedOutOf = positions.size;
  summaries.sort((a, b) => (positions.get(a.studentId) ?? Infinity) - (positions.get(b.studentId) ?? Infinity) || b.averagePercentage - a.averagePercentage);

  const now = new Date();

  await db.$tx(async (tx) => {
    for (const s of summaries) {
      await tx.termResult.upsert({
        where:  { studentId_termId: { studentId: s.studentId, termId } },
        update: {
          totalMarks:    s.totalMarks,
          percentage:    s.averagePercentage,
          averagePercentage: s.averagePercentage,
          classPosition: positions.get(s.studentId) ?? null,
          subjectsSat:     s.subjectsTaken,
          subjectsTaken:   s.subjectsTaken,
          subjectsPassed:  s.subjectsPassed,
          subjectsOffered: s.subjectsOffered,
          rankedOutOf,
          classSize:     students.length,
          letterGrade:   s.letterGrade,
          nextTermStartDate: nextTerm?.startDate ?? null,
          published:     true,
          publishedAt:   now,
        },
        create: {
          schoolId:      user.schoolId,
          studentId:     s.studentId,
          termId,
          totalMarks:    s.totalMarks,
          percentage:    s.averagePercentage,
          averagePercentage: s.averagePercentage,
          classPosition: positions.get(s.studentId) ?? null,
          subjectsSat:     s.subjectsTaken,
          subjectsTaken:   s.subjectsTaken,
          subjectsPassed:  s.subjectsPassed,
          subjectsOffered: s.subjectsOffered,
          rankedOutOf,
          classSize:     students.length,
          letterGrade:   s.letterGrade,
          nextTermStartDate: nextTerm?.startDate ?? null,
          published:     true,
          publishedAt:   now,
        },
      });
    }

    // Freeze each score's grade with the boundaries in force now (only rows that differ are touched).
    const maxBySubject = new Map(offered.map((o) => [o.id, o.maxMark]));
    for (const m of allMarks) {
      if (m.status !== 'VERIFIED') continue;
      const max = maxBySubject.get(m.subjectId) ?? 0;
      const pct = max > 0 ? (m.rawMark.toNumber() / max) * 100 : 0;
      const band = gradeFor(pct, boundaries);
      const min = band?.minPercent ?? null;
      const top = band?.maxPercent ?? null;
      if (
        (band?.letterGrade ?? null) !== m.letterGrade ||
        min !== (m.gradeMinPercent?.toNumber() ?? null) ||
        top !== (m.gradeMaxPercent?.toNumber() ?? null)
      ) {
        await tx.mark.update({ where: { id: m.id }, data: { letterGrade: band?.letterGrade ?? null, gradeMinPercent: min, gradeMaxPercent: top } });
      }
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
    ? summaries.reduce((n, s) => n + s.averagePercentage, 0) / summaries.length
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
