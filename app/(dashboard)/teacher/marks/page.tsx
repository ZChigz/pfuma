import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ASSIGNMENT_STATUS_LABELS } from '@/lib/results';
import type { SessionUser, AssignmentMarkStatus } from '@/types';

const STATUS_BADGE: Record<AssignmentMarkStatus, string> = {
  NOT_STARTED: 'bg-stone-100 text-[#78716c]',
  IN_PROGRESS: 'bg-amber-50 text-amber-800',
  VERIFIED:    'bg-emerald-50 text-emerald-800',
  PUBLISHED:   'bg-emerald-50 text-emerald-800',
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

  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { currentTerm: true },
  });
  const currentTerm = school?.currentTerm ?? '';

  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, teacherId: user.id, term: currentTerm },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  const rows = await Promise.all(
    assignments.map(async (a) => {
      const [marksEntered, totalStudents] = await Promise.all([
        prisma.mark.count({
          where: { schoolId: user.schoolId, subjectId: a.subjectId, term: a.term, student: { classId: a.classId } },
        }),
        prisma.student.count({
          where: { schoolId: user.schoolId, classId: a.classId, active: true },
        }),
      ]);
      return { ...a, marksEntered, totalStudents };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">My teaching assignments — {currentTerm || 'current term'}</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Select an assignment to enter marks</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No subjects are assigned to you for {currentTerm || 'this term'}. Ask your administrator.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 rounded-xl border border-[#e7e5e4] bg-white p-4 shadow-sm">
              <div>
                <p className="text-base font-bold text-[#292524]">{a.class.name} — {a.subject.name}</p>
                <p className="mt-0.5 text-xs text-[#78716c]">{a.subject.code} &middot; out of {a.subject.maxMark}</p>
              </div>
              <p className="text-sm text-[#78716c]">
                {a.totalStudents} student{a.totalStudents !== 1 ? 's' : ''} &middot; {a.marksEntered} mark{a.marksEntered !== 1 ? 's' : ''} entered
              </p>
              <span className={cn('inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS_BADGE[a.marksStatus])}>
                Status: {ASSIGNMENT_STATUS_LABELS[a.marksStatus]}{a.marksStatus === 'VERIFIED' ? ' ✓' : ''}
              </span>
              <Link
                href={`/teacher/marks/${a.id}`}
                className={cn(
                  'mt-1 inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40',
                  a.marksStatus === 'VERIFIED' || a.marksStatus === 'PUBLISHED'
                    ? 'border border-[#e7e5e4] bg-white text-[#78716c] hover:bg-stone-50'
                    : 'bg-[#065f46] text-white hover:bg-[#047857]',
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
