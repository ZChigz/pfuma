import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TermSelect } from '@/components/results/TermSelect';
import { PublishResultsButton } from '@/components/results/PublishResultsButton';
import { ExportResultsButton } from '@/components/results/ExportResultsButton';
import { UnlockSubjectLink } from '@/components/results/UnlockSubjectLink';
import { ReopenResultsButton } from '@/components/results/ReopenResultsButton';
import { listTerms } from '@/lib/academic/terms';
import { classRosterIds } from '@/lib/academic/roster';
import type { SessionUser, AssignmentMarkStatus } from '@/types';

const STATUS_DISPLAY: Record<AssignmentMarkStatus, { icon: string; label: string; className: string }> = {
  NOT_STARTED: { icon: '✗', label: 'NOT STARTED', className: 'text-muted' },
  IN_PROGRESS: { icon: '⏳', label: 'IN PROGRESS', className: 'text-warn' },
  VERIFIED:    { icon: '✓', label: 'VERIFIED',     className: 'text-primary' },
  PUBLISHED:   { icon: '✓', label: 'PUBLISHED',    className: 'text-primary' },
};

export default async function HeadResultsPage({
  searchParams,
}: {
  searchParams: { classId?: string; termId?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'HEAD') redirect('/');

  const { schoolId } = user;

  const [terms, classes] = await Promise.all([
    listTerms(schoolId, db),
    db.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
    }),
  ]);

  const term = terms.find((t) => t.id === searchParams.termId) ?? terms.find((t) => t.status === 'OPEN') ?? terms[0];
  const selectedTermId = term?.id ?? '';
  const selectedTerm = term?.name ?? 'No terms yet';
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
    subjectsSat: number | null;
    subjectsOffered: number | null;
  }> = [];
  let rankedOutOf: number | null = null;

  if (selectedClass && term) {
    assignments = await db.subjectAssignment.findMany({
      where: { schoolId, classId: selectedClass.id, termId: selectedTermId, subject: { active: true } },
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

  if (selectedClass && term && isPublished) {
    const subjectIds = assignments.map((a) => a.subjectId);
    // The class list for that term comes from Enrollment.
    const studentIds = await classRosterIds(selectedClass.id, selectedTermId, db);
    const [termResults, marks] = await Promise.all([
      db.termResult.findMany({
        where: { schoolId, termId: selectedTermId, studentId: { in: studentIds } },
        include: { student: { select: { id: true, fullName: true } } },
        orderBy: { classPosition: 'asc' },
      }),
      db.mark.findMany({
        where: { schoolId, subjectId: { in: subjectIds }, termId: selectedTermId, status: 'PUBLISHED', studentId: { in: studentIds } },
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
        subjectsSat: tr.subjectsSat,
        subjectsOffered: tr.subjectsOffered,
      };
    });
    rankedOutOf = termResults.find((tr) => tr.rankedOutOf != null)?.rankedOutOf ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Results</h1>
          <p className="mt-1 text-sm text-muted">Mark verification &amp; publishing</p>
        </div>
        {selectedClass && (
          <div className="flex items-center gap-3">
            <TermSelect classId={selectedClass.id} termId={selectedTermId} terms={terms.map((t) => ({ id: t.id, name: t.name }))} />
            {isPublished && (
              <span className="inline-flex items-center rounded-full bg-success-bg px-3 py-1 text-sm font-medium text-primary">
                ✓ Published
              </span>
            )}
            {isPublished && term?.status !== 'CLOSED' && user.role === 'HEAD' && (
              <ReopenResultsButton classId={selectedClass.id} className={selectedClass.name} termId={selectedTermId} termName={selectedTerm} />
            )}
            {isPublished && <ExportResultsButton classId={selectedClass.id} className={selectedClass.name} termId={selectedTermId} termName={selectedTerm} />}
          </div>
        )}
      </div>

      {/* Class selector */}
      <div className="flex flex-wrap gap-2 border-b border-line">
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`/head/results?classId=${c.id}&termId=${selectedTermId}`}
            className={cn(
              'min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              selectedClassId === c.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      {!selectedClass ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No classes set up yet.
        </p>
      ) : assignments.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No subjects assigned to {selectedClass.name} for {selectedTerm}.
        </p>
      ) : (
        <>
          {/* Class overview */}
          <div className="overflow-hidden rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Subject', 'Teacher', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {assignments.map((a) => {
                  const status = STATUS_DISPLAY[a.marksStatus];
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-3 font-medium">{a.subject.name}</td>
                      <td className="px-4 py-3 text-muted">{a.teacher.fullName}</td>
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

          <p className="text-sm font-medium text-ink">
            {verifiedCount} of {assignments.length} subjects verified
          </p>

          {!allVerified && (
            <p className="rounded-xl border border-transparent bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
              ⚠ Cannot publish until all subjects are verified
            </p>
          )}

          {!isPublished && (
            <PublishResultsButton
              classId={selectedClass.id}
              className={selectedClass.name}
              termId={selectedTermId}
              termName={selectedTerm}
              disabled={!allVerified}
            />
          )}

          {/* Results table */}
          {isPublished && resultRows.length > 0 && (
            <p className="text-sm text-muted">
              Positions use each student&apos;s average percentage over the subjects they sat, so a missed exam or a different
              elective is not counted as zero. {rankedOutOf != null ? `${rankedOutOf} of ${resultRows.length} students are ranked; ` : ''}
              a student who sat fewer than half of the core subjects is shown as &ldquo;Not ranked&rdquo;.
            </p>
          )}
          {isPublished && resultRows.length > 0 && (
            <div className="overflow-x-auto rounded-2xl bg-white">
              <table className="w-full text-left text-sm text-ink">
                <thead className="border-b border-line bg-white">
                  <tr>
                    <th className="px-4 py-3.5 text-xs font-medium text-subtle">Position</th>
                    <th className="px-4 py-3.5 text-xs font-medium text-subtle">Name</th>
                    {assignments.map((a) => (
                      <th key={a.subjectId} className="px-4 py-3.5 text-xs font-medium text-subtle">
                        {a.subject.name}
                      </th>
                    ))}
                    <th className="px-4 py-3.5 text-xs font-medium text-subtle">Total</th>
                    <th className="px-4 py-3.5 text-xs font-medium text-subtle">%</th>
                    <th className="px-4 py-3.5 text-xs font-medium text-subtle">Subjects sat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {resultRows.map((r) => (
                    <tr key={r.studentId}>
                      <td className="px-4 py-3 font-bold tabular-nums">{r.position ?? 'Not ranked'}</td>
                      <td className="px-4 py-3 font-medium">{r.fullName}</td>
                      {assignments.map((a) => (
                        <td key={a.subjectId} className="px-4 py-3 tabular-nums">
                          {r.marks.get(a.subjectId) ?? '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 tabular-nums font-medium">{r.total}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{r.percentage.toFixed(1)}%</td>
                      <td className="px-4 py-3 tabular-nums text-muted">
                        {r.subjectsSat != null ? `${r.subjectsSat} of ${r.subjectsOffered}` : '—'}
                      </td>
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
