import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { can, guardPage } from '@/lib/access';
import { ResultsFilters } from '@/components/results/ResultsFilters';
import { listTerms } from '@/lib/academic/terms';
import { boundariesFor, gradeFor } from '@/lib/results';
import type { SessionUser } from '@/types';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { levelId?: string; termId?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  const access = await guardPage(user, 'exams.results.view');

  const levelId = searchParams.levelId ?? '';
  const termId  = searchParams.termId  ?? '';
  const [levels, terms] = await Promise.all([
    db.level.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    listTerms(user.schoolId, db),
  ]);
  const grade = levels.find((l) => l.id === levelId)?.name ?? '';
  const term  = terms.find((t) => t.id === termId)?.name ?? '';

  const canPublish = can(access, 'exams.results.publish');

  // Fetch results only when both filters are set
  type ResultRow = {
    id: string;
    studentId: string;
    totalMarks: number;
    percentage: number;
    classPosition: number | null;
    published: boolean;
    student: { fullName: string; className: string };
    letterGrade: string;
  };

  let results: ResultRow[] = [];
  let isPublished = false;
  let pendingMarkCount = 0;

  if (grade && term) {
    const [boundaryRows, levelRow] = await Promise.all([
      db.gradeBoundary.findMany({ where: { schoolId: user.schoolId } }),
      db.level.findFirst({ where: { id: levelId, schoolId: user.schoolId }, select: { category: true } }),
    ]);
    // The set that applies to this level and term (most specific wins), not any band that happens to fit.
    const gradeBoundaries = boundariesFor(
      boundaryRows.map((b) => ({ minPercent: b.minPercent.toNumber(), maxPercent: b.maxPercent.toNumber(), letterGrade: b.letterGrade, levelId: b.levelId, termId: b.termId, category: b.category })),
      levelId,
      termId,
      levelRow?.category ?? null,
    );

    const getLetterGrade = (pct: number): string => gradeFor(pct, gradeBoundaries)?.letterGrade ?? '—';

    // Students in that level FOR THAT TERM (from Enrollment), not their level today.
    const enrolled = await db.enrollment.findMany({
      where: { schoolId: user.schoolId, termId, class: { levelId } },
      select: { studentId: true, class: { select: { name: true } } },
    });
    const classByStudent = new Map(enrolled.map((e) => [e.studentId, e.class.name]));
    const rows = await db.termResult.findMany({
      where: {
        schoolId: user.schoolId, termId, studentId: { in: Array.from(classByStudent.keys()) },
        // not the empty rows that only hold remarks until the class is published
        OR: [{ published: true }, { subjectsOffered: { not: null } }],
      },
      include: { student: { select: { fullName: true } } },
      orderBy: [{ classPosition: 'asc' }, { student: { fullName: 'asc' } }],
    });

    results = rows.map((r) => ({
      id:            r.id,
      studentId:     r.studentId,
      totalMarks:    r.totalMarks.toNumber(),
      percentage:    r.percentage.toNumber(),
      classPosition: r.classPosition,
      published:     r.published,
      student:       { fullName: r.student.fullName, className: classByStudent.get(r.studentId) ?? '' },
      letterGrade:   r.letterGrade ?? getLetterGrade(r.percentage.toNumber()),
    }));

    isPublished = results.some((r) => r.published);

    if (results.length === 0) {
      pendingMarkCount = await db.mark.count({
        where: { schoolId: user.schoolId, termId, studentId: { in: Array.from(classByStudent.keys()) } },
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Report Cards</h1>
          <p className="mt-1 text-sm text-muted">View results and download PDF reports</p>
        </div>
        {canPublish && grade && term && !isPublished && (
          <Link
            href="/head/results"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary transition-colors hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            Go to Results to verify &amp; publish
          </Link>
        )}
        {isPublished && (
          <span className="inline-flex items-center rounded-full bg-success-bg px-3 py-1 text-sm font-medium text-primary">
            ✓ Published
          </span>
        )}
      </div>

      {/* Filters */}
      <ResultsFilters levels={levels} terms={terms.map((t) => ({ id: t.id, name: t.name }))} currentLevelId={levelId} currentTermId={termId} />

      {/* Results table */}
      {!grade || !term ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          Select a level and term to view results.
        </p>
      ) : results.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-12 text-center">
          {pendingMarkCount > 0 ? (
            <>
              <p className="text-sm font-medium text-ink">
                {pendingMarkCount} mark{pendingMarkCount !== 1 ? 's' : ''} entered for{' '}
                <strong>{grade}</strong> — <strong>{term}</strong>
              </p>
              <p className="mt-1 text-sm text-muted">
                {canPublish
                  ? 'Use "Go to Results to verify & publish" above once all subjects have been verified by their teachers.'
                  : 'Results have not been published yet. Ask your Head or Director to publish.'}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              No marks entered yet for <strong>{grade}</strong> — <strong>{term}</strong>.
              {canPublish ? ' Teachers must enter marks before you can publish.' : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Pos', 'Student', 'Total', '%', 'Grade', 'PDF'].map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="w-12 px-4 py-3 tabular-nums text-muted">
                    {r.classPosition ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.student.fullName}</p>
                    <p className="text-xs text-muted">{r.student.className}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.totalMarks.toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {r.percentage.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-tint px-2.5 py-0.5 text-xs font-semibold text-ink">
                      {r.letterGrade}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/results/reports/${r.studentId}?termId=${termId}`}
                      download
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-xl border border-line bg-white px-2.5 py-1 text-xs font-medium text-primary hover:bg-rowhover focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path
                          fillRule="evenodd"
                          d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
