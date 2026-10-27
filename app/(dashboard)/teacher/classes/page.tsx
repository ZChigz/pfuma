import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { classRosterIds } from '@/lib/academic/roster';
import type { SessionUser } from '@/types';

export default async function TeacherClassesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await guardPage(user, 'academics.classes.view');

  const assignments = await db.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, teacherId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      class:   { select: { id: true, name: true } },
      term:    { select: { name: true } },
    },
    orderBy: [{ term: { startDate: 'desc' } }, { class: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  const rows = await Promise.all(
    assignments
      .map(async (a) => {
        const studentIds = await classRosterIds(a.classId, a.termId, db);
        const marksEntered = await db.mark.count({
          where: { schoolId: user.schoolId, subjectId: a.subjectId, termId: a.termId, studentId: { in: studentIds } },
        });
        const totalStudents = studentIds.length;
        return {
          id: a.id,
          className: a.class.name,
          subjectName: `${a.subject.name} (${a.subject.code})`,
          term: a.term.name,
          marksEntered,
          totalStudents,
        };
      }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">My Classes</h1>
        <p className="mt-1 text-sm text-muted">Your class and subject assignments</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No classes are assigned to you. Ask your head of department.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Class', 'Subject', 'Term', 'Marks Entered'].map((h) => (
                  <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">{r.className}</td>
                  <td className="px-4 py-3">{r.subjectName}</td>
                  <td className="px-4 py-3 text-muted">{r.term}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.marksEntered} / {r.totalStudents}
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
