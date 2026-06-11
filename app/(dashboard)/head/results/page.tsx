import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TermSelect } from '@/components/results/TermSelect';
import { PublishResultsButton } from '@/components/results/PublishResultsButton';
import { ExportResultsButton } from '@/components/results/ExportResultsButton';
import { UnlockSubjectLink } from '@/components/results/UnlockSubjectLink';
import { TERMS } from '@/lib/results';
import type { SessionUser, AssignmentMarkStatus } from '@/types';

const STATUS_DISPLAY: Record<AssignmentMarkStatus, { icon: string; label: string; className: string }> = {
  NOT_STARTED: { icon: '✗', label: 'NOT STARTED', className: 'text-[#78716c]' },
  IN_PROGRESS: { icon: '⏳', label: 'IN PROGRESS', className: 'text-amber-700' },
  VERIFIED:    { icon: '✓', label: 'VERIFIED',     className: 'text-emerald-700' },
  PUBLISHED:   { icon: '✓', label: 'PUBLISHED',    className: 'text-emerald-700' },
};

export default async function HeadResultsPage({
  searchParams,
}: {
  searchParams: { classId?: string; term?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const { schoolId } = user;

  const [school, classes] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { currentTerm: true } }),
    prisma.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
  ]);

  const selectedTerm = searchParams.term || school?.currentTerm || TERMS[0];
  const selectedClassId = searchParams.classId || classes[0]?.id || '';
  const selectedClass = classes.find((c) => c.id === selectedClassId);

  let assignments: Array<{
    id: string;
    teacherId: string;
    subjectId: string;
    marksStatus: AssignmentMarkStatus;
    subject: { id: string; name: string; maxMark: number };
    teacher: { fullName: string };
  }> = [];

  let resultRows: Array<{
    studentId: string;
    fullName: string;
    marks: Map<string, number>;
    total: number;
    percentage: number;
    position: number | null;
  }> = [];

  if (selectedClass) {
    assignments = await prisma.subjectAssignment.findMany({
      where: { schoolId, classId: selectedClass.id, term: selectedTerm, subject: { active: true } },
      include: {
        subject: { select: { id: true, name: true, maxMark: true } },
        teacher: { select: { fullName: true } },
      },
      orderBy: { subject: { name: 'asc' } },
    });
  }

  const verifiedCount = assignments.filter((a) => a.marksStatus === 'VERIFIED' || a.marksStatus === 'PUBLISHED').length;
  const allVerified = assignments.length > 0 && verifiedCount === assignments.length;
  const isPublished = assignments.length > 0 && assignments.every((a) => a.marksStatus === 'PUBLISHED');

  if (selectedClass && isPublished) {
    const subjectIds = assignments.map((a) => a.subjectId);
    const [termResults, marks] = await Promise.all([
      prisma.termResult.findMany({
        where: { schoolId, term: selectedTerm, student: { classId: selectedClass.id } },
        include: { student: { select: { id: true, fullName: true } } },
        orderBy: { classPosition: 'asc' },
      }),
      prisma.mark.findMany({
        where: { schoolId, subjectId: { in: subjectIds }, term: selectedTerm, status: 'PUBLISHED', student: { classId: selectedClass.id } },
      }),
    ]);

    resultRows = termResults.map((tr) => {
      const studentMarks = new Map<string, number>();
      for (const m of marks) {
        if (m.studentId === tr.studentId) studentMarks.set(m.subjectId, m.rawMark.toNumber());
      }
      return {
        studentId:  tr.studentId,
        fullName:   tr.student.fullName,
        marks:      studentMarks,
        total:      tr.totalMarks.toNumber(),
        percentage: tr.percentage.toNumber(),
        position:   tr.classPosition,
      };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Results</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Mark verification &amp; publishing</p>
        </div>
        {selectedClass && (
          <div className="flex items-center gap-3">
            <TermSelect classId={selectedClass.id} term={selectedTerm} />
            {isPublished && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                ✓ Published
              </span>
            )}
            {isPublished && <ExportResultsButton classId={selectedClass.id} className={selectedClass.name} term={selectedTerm} />}
          </div>
        )}
      </div>

      {/* Class selector */}
      <div className="flex flex-wrap gap-2 border-b border-[#e7e5e4]">
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`/head/results?classId=${c.id}&term=${encodeURIComponent(selectedTerm)}`}
            className={cn(
              'min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              selectedClassId === c.id
                ? 'border-[#065f46] text-[#065f46]'
                : 'border-transparent text-[#78716c] hover:text-[#292524]',
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {!selectedClass ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No classes set up yet.
        </p>
      ) : assignments.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No subjects assigned to {selectedClass.name} for {selectedTerm}.
        </p>
      ) : (
        <>
          {/* Class overview */}
          <div className="overflow-hidden rounded-xl border border-[#e7e5e4] bg-white">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Subject', 'Teacher', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4]">
                {assignments.map((a) => {
                  const status = STATUS_DISPLAY[a.marksStatus];
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-3 font-medium">{a.subject.name}</td>
                      <td className="px-4 py-3 text-[#78716c]">{a.teacher.fullName}</td>
                      <td className={cn('px-4 py-3 font-medium', status.className)}>
                        {status.icon} {status.label}
                      </td>
                      <td className="px-4 py-3">
                        {a.marksStatus === 'VERIFIED' && (
                          <UnlockSubjectLink
                            assignmentId={a.id}
                            teacherName={a.teacher.fullName}
                            subjectName={a.subject.name}
                            className={selectedClass.name}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-sm font-medium text-[#292524]">
            {verifiedCount} of {assignments.length} subjects verified
          </p>

          {!allVerified && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              ⚠ Cannot publish until all subjects are verified
            </p>
          )}

          {!isPublished && (
            <PublishResultsButton
              classId={selectedClass.id}
              className={selectedClass.name}
              term={selectedTerm}
              disabled={!allVerified}
            />
          )}

          {/* Results table */}
          {isPublished && resultRows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
              <table className="w-full text-left text-sm text-[#292524]">
                <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Position</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Name</th>
                    {assignments.map((a) => (
                      <th key={a.subjectId} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                        {a.subject.name}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Total</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e5e4] bg-white">
                  {resultRows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="px-4 py-3 font-bold tabular-nums">{r.position ?? '—'}</td>
                      <td className="px-4 py-3 font-medium">{r.fullName}</td>
                      {assignments.map((a) => (
                        <td key={a.subjectId} className="px-4 py-3 tabular-nums">
                          {r.marks.get(a.subjectId) ?? '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 tabular-nums font-medium">{r.total}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{r.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
