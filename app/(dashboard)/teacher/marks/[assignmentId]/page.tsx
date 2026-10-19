import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect, notFound } from 'next/navigation';
import { MarkEntryGrid } from '@/components/results/MarkEntryGrid';
import type { SessionUser } from '@/types';

export default async function TeacherMarkEntryPage({ params }: { params: { assignmentId: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'TEACHER') redirect('/');

  const assignment = await db.subjectAssignment.findFirst({
    where: { id: params.assignmentId, schoolId: user.schoolId, teacherId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true, maxMark: true } },
      class:   { select: { id: true, name: true } },
      term:    { select: { id: true, name: true } },
    },
  });
  if (!assignment) notFound();

  return (
    <MarkEntryGrid
      assignmentId={assignment.id}
      classId={assignment.classId}
      className={assignment.class.name}
      subjectId={assignment.subjectId}
      subjectName={assignment.subject.name}
      maxMark={assignment.subject.maxMark}
      termId={assignment.term.id}
      termName={assignment.term.name}
    />
  );
}
