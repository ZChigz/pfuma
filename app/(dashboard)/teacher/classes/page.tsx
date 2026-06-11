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
        <h1 className="text-2xl font-bold text-[#292524]">My Classes</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Your class and subject assignments</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No classes are assigned to you. Ask your head of department.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['Class', 'Subject', 'Term', 'Marks Entered'].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">{r.className}</td>
                  <td className="px-4 py-3">{r.subjectName}</td>
                  <td className="px-4 py-3 text-[#78716c]">{r.term}</td>
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
