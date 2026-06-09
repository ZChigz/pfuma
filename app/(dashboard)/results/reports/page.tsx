import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { ResultsFilters } from '@/components/results/ResultsFilters';
import { PublishButton } from '@/components/results/PublishButton';
import type { SessionUser } from '@/types';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { grade?: string; term?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  const grade = searchParams.grade ?? '';
  const term  = searchParams.term  ?? '';

  const canPublish = Permission.publishResults.includes(user.role);

  // Fetch results only when both filters are set
  type ResultRow = {
    id: string;
    studentId: string;
    term: string;
    totalMarks: number;
    percentage: number;
    classPosition: number | null;
    published: boolean;
    student: { fullName: string; grade: string };
    letterGrade: string;
  };

  let results: ResultRow[] = [];
  let isPublished = false;

  if (grade && term) {
    const gradeBoundaries = await prisma.gradeBoundary.findMany({
      where: { schoolId: user.schoolId },
    });

    function getLetterGrade(pct: number): string {
      const b = gradeBoundaries.find(
        (b) => pct >= b.minPercent.toNumber() && pct <= b.maxPercent.toNumber(),
      );
      return b?.letterGrade ?? '—';
    }

    const rows = await prisma.termResult.findMany({
      where: {
        schoolId: user.schoolId,
        term,
        student: { grade },
      },
      include: { student: { select: { fullName: true, grade: true } } },
      orderBy: [{ classPosition: 'asc' }, { student: { fullName: 'asc' } }],
    });

    results = rows.map((r) => ({
      id:            r.id,
      studentId:     r.studentId,
      term:          r.term,
      totalMarks:    r.totalMarks.toNumber(),
      percentage:    r.percentage.toNumber(),
      classPosition: r.classPosition,
      published:     r.published,
      student:       r.student,
      letterGrade:   getLetterGrade(r.percentage.toNumber()),
    }));

    isPublished = results.some((r) => r.published);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Report Cards</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">View results and download PDF reports</p>
        </div>
        {canPublish && grade && term && !isPublished && (
          <PublishButton grade={grade} term={term} />
        )}
        {isPublished && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
            ✓ Published
          </span>
        )}
      </div>

      {/* Filters */}
      <ResultsFilters currentGrade={grade} currentTerm={term} />

      {/* Results table */}
      {!grade || !term ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          Select a grade and term to view results.
        </p>
      ) : results.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No results found for <strong>{grade}</strong> — <strong>{term}</strong>.
          {canPublish && ' Use the Publish Results button after entering marks.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['Pos', 'Student', 'Total', '%', 'Grade', 'PDF'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="w-12 px-4 py-3 tabular-nums text-[#78716c]">
                    {r.classPosition ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.student.fullName}</p>
                    <p className="text-xs text-[#78716c]">{r.student.grade}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{r.totalMarks.toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {r.percentage.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-[#292524]">
                      {r.letterGrade}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/results/reports/${r.studentId}?term=${encodeURIComponent(term)}`}
                      download
                      className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[#e7e5e4] bg-white px-2.5 py-1 text-xs font-medium text-[#065f46] hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
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
