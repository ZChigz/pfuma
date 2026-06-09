import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { Badge } from '@/components/ui/Badge';
import { AddSubjectModal } from '@/components/results/AddSubjectModal';
import { AssignTeacherModal } from '@/components/results/AssignTeacherModal';
import type { SessionUser } from '@/types';

export default async function SubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  const canManage = Permission.manageSubjects.includes(user.role);

  const [subjects, teachers, school] = await Promise.all([
    prisma.subject.findMany({
      where: { schoolId: user.schoolId },
      include: {
        assignments: {
          include: { teacher: { select: { id: true, fullName: true } } },
          orderBy: { term: 'desc' },
        },
      },
      orderBy: [{ grade: 'asc' }, { type: 'asc' }, { name: 'asc' }],
    }),
    prisma.user.findMany({
      where: { schoolId: user.schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { currentTerm: true },
    }),
  ]);

  const currentTerm = school?.currentTerm ?? '';

  // Group by grade preserving sort order
  const byGrade = new Map<string, typeof subjects>();
  for (const s of subjects) {
    const arr = byGrade.get(s.grade) ?? [];
    arr.push(s);
    byGrade.set(s.grade, arr);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Subjects</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Manage curriculum subjects and teacher assignments</p>
        </div>
        {canManage && <AddSubjectModal />}
      </div>

      {byGrade.size === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No subjects yet.{canManage ? ' Click "+ Add Subject" to get started.' : ''}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(byGrade.entries()).map(([grade, gradeSubjects]) => (
            <section key={grade}>
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#292524]">
                {grade}
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-[#78716c]">
                  {gradeSubjects.length}
                </span>
              </h2>
              <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
                <table className="w-full text-left text-sm text-[#292524]">
                  <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                    <tr>
                      {['Name', 'Code', 'Type', 'Max Mark', 'Assigned Teacher (latest)', ...(canManage ? [''] : [])].map(
                        (h, i) => (
                          <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e7e5e4] bg-white">
                    {gradeSubjects.map((s) => {
                      const latest = s.assignments[0];
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-3 font-medium">{s.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[#78716c]">{s.code}</td>
                          <td className="px-4 py-3">
                            <Badge label={s.type} variant={s.type === 'CORE' ? 'success' : 'neutral'} />
                          </td>
                          <td className="px-4 py-3 tabular-nums">{s.maxMark}</td>
                          <td className="px-4 py-3">
                            {latest ? (
                              <div>
                                <p className="font-medium">{latest.teacher.fullName}</p>
                                <p className="text-xs text-[#78716c]">{latest.term}</p>
                              </div>
                            ) : (
                              <span className="text-[#78716c]">—</span>
                            )}
                          </td>
                          {canManage && (
                            <td className="px-4 py-3">
                              <AssignTeacherModal
                                subject={{ id: s.id, name: s.name, code: s.code, grade: s.grade }}
                                teachers={teachers}
                                currentTerm={currentTerm}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
