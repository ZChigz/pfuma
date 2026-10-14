import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@/types';

export default async function TeacherClassesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'TEACHER') redirect('/');

  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId: user.schoolId, teacherId: user.id },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      class:   { select: { id: true, name: true } },
    },
    orderBy: [{ class: { name: 'asc' } }, { subject: { name: 'asc' } }, { term: 'desc' }],
  });

  const rows = await Promise.all(
    assignments
      .map(async (a) => {
        const [marksEntered, totalStudents] = await Promise.all([
          prisma.mark.count({
            where: { schoolId: user.schoolId, subjectId: a.subjectId, term: a.term, student: { classId: a.classId } },
          }),
          prisma.student.count({
            where: { schoolId: user.schoolId, classId: a.classId, active: true },
          }),
        ]);
        return {
          id: a.id,
          className: a.class.name,
          subjectName: `${a.subject.name} (${a.subject.code})`,
          term: a.term,
          marksEntered,
          totalStudents,
        };
      }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#14301f]">My Classes</h1>
        <p className="mt-0.5 text-sm text-[#6b7a70]">Your class and subject assignments</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-[#6b7a70]">
          No classes are assigned to you. Ask your head of department.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
          <table className="w-full text-left text-sm text-[#14301f]">
            <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
              <tr>
                {['Class', 'Subject', 'Term', 'Marks Entered'].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e9e4] bg-white">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">{r.className}</td>
                  <td className="px-4 py-3">{r.subjectName}</td>
                  <td className="px-4 py-3 text-[#6b7a70]">{r.term}</td>
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
