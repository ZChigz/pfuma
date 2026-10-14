import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ASSIGNMENT_STATUS_LABELS } from '@/lib/results';
import { getOpenTerm } from '@/lib/academic/terms';
import { classRosterIds } from '@/lib/academic/roster';
import type { SessionUser, AssignmentMarkStatus } from '@/types';

const STATUS_BADGE: Record<AssignmentMarkStatus, string> = {
  NOT_STARTED: 'bg-tint text-muted',
  IN_PROGRESS: 'bg-warn-bg text-warn',
  VERIFIED:    'bg-success-bg text-primary',
  PUBLISHED:   'bg-success-bg text-primary',
};

const ACTION_LABEL: Record<AssignmentMarkStatus, string> = {
  NOT_STARTED: 'Enter Marks',
  IN_PROGRESS: 'Enter/Edit Marks',
  VERIFIED:    'View only — locked',
  PUBLISHED:   'View only — locked',
};

export default async function TeacherMarksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'TEACHER') redirect('/');

  const openTerm = await getOpenTerm(user.schoolId);
  const currentTerm = openTerm?.name ?? '';

  const assignments = !openTerm ? [] : await prisma.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, teacherId: user.id, termId: openTerm.id },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  const rows = await Promise.all(
    assignments.map(async (a) => {
      const studentIds = await classRosterIds(a.classId, a.termId);
      const marksEntered = await prisma.mark.count({
        where: { schoolId: user.schoolId, subjectId: a.subjectId, termId: a.termId, studentId: { in: studentIds } },
      });
      return { ...a, marksEntered, totalStudents: studentIds.length };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">My teaching assignments — {currentTerm || 'current term'}</h1>
        <p className="mt-1 text-sm text-muted">Select an assignment to enter marks</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No subjects are assigned to you for {currentTerm || 'this term'}. Ask your administrator.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 rounded-2xl bg-white p-4">
              <div>
                <p className="text-base font-semibold text-ink">{a.class.name} — {a.subject.name}</p>
                <p className="mt-0.5 text-xs text-muted">{a.subject.code} &middot; out of {a.subject.maxMark}</p>
              </div>
              <p className="text-sm text-muted">
                {a.totalStudents} student{a.totalStudents !== 1 ? 's' : ''} &middot; {a.marksEntered} mark{a.marksEntered !== 1 ? 's' : ''} entered
              </p>
              <span className={cn('inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE[a.marksStatus])}>
                Status: {ASSIGNMENT_STATUS_LABELS[a.marksStatus]}{a.marksStatus === 'VERIFIED' ? ' ✓' : ''}
              </span>
              <Link
                href={`/teacher/marks/${a.id}`}
                className={cn(
                  'mt-1 inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                  a.marksStatus === 'VERIFIED' || a.marksStatus === 'PUBLISHED'
                    ? 'border border-line bg-white text-muted hover:bg-rowhover'
                    : 'bg-primary text-white hover:bg-primary-hover',
                )}
              >
                {ACTION_LABEL[a.marksStatus]}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
