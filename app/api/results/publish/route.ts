import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { canPublishResults } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { PublishResultsSchema } from '@/lib/validations/results';
import type { SessionUser } from '@/types';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canPublishResults(user.role); }
  catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, PublishResultsSchema);
  if ('error' in parsed) return parsed.error;
  const { grade, term } = parsed.data;

  // Fetch all active students in the grade with their marks for the term
  const students = await prisma.student.findMany({
    where: { schoolId: user.schoolId, grade, active: true },
    include: {
      marks: {
        where: { term, schoolId: user.schoolId },
        include: { subject: { select: { maxMark: true } } },
      },
    },
  });

  // Compute totals per student
  const summaries = students.map((s) => {
    const totalRaw = s.marks.reduce((n, m) => n + m.rawMark.toNumber(), 0);
    const totalMax = s.marks.reduce((n, m) => n + m.subject.maxMark, 0);
    const percentage = totalMax > 0 ? (totalRaw / totalMax) * 100 : 0;
    return { studentId: s.id, totalMarks: totalRaw, percentage, classPosition: 0 };
  });

  // Sort by percentage descending and assign positions (ties share same rank)
  summaries.sort((a, b) => b.percentage - a.percentage);
  let pos = 1;
  for (let i = 0; i < summaries.length; i++) {
    if (i > 0 && summaries[i].percentage < summaries[i - 1].percentage) pos = i + 1;
    summaries[i].classPosition = pos;
  }

  const now = new Date();

  const published = await prisma.$transaction(async (tx) => {
    await Promise.all(
      summaries.map((s) =>
        tx.termResult.upsert({
          where:  { studentId_term: { studentId: s.studentId, term } },
          update: {
            totalMarks:    s.totalMarks,
            percentage:    s.percentage,
            classPosition: s.classPosition,
            published:     true,
            publishedAt:   now,
          },
          create: {
            schoolId:      user.schoolId,
            studentId:     s.studentId,
            term,
            totalMarks:    s.totalMarks,
            percentage:    s.percentage,
            classPosition: s.classPosition,
            published:     true,
            publishedAt:   now,
          },
        }),
      ),
    );

    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'PUBLISH_RESULTS',
        entityType: 'TermResult',
        entityId:   `${grade}:${term}`,
        detail:     `Published ${summaries.length} results for ${grade} — ${term}`,
      },
      tx,
    );

    return summaries.length;
  });

  return apiSuccess({ published });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/results/publish', _POST as H);
