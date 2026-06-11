import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { AddSubjectModal } from '@/components/admin/AddSubjectModal';
import { SubjectRowActions } from '@/components/admin/SubjectRowActions';
import { AssignSubjectModal } from '@/components/admin/AssignSubjectModal';
import { RemoveAssignmentButton } from '@/components/admin/RemoveAssignmentButton';
import { GradeBoundariesManager } from '@/components/results/GradeBoundariesManager';
import { canManageSubjects } from '@/lib/permissions';
import type { SessionUser } from '@/types';

export default async function AdminSubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  try { await canManageSubjects(user.role); } catch { redirect('/'); }

  const { schoolId } = user;

  const [subjects, classes, teachers, school] = await Promise.all([
    prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    }),
    prisma.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
    prisma.user.findMany({
      where: { schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { currentTerm: true },
    }),
  ]);

  const currentTerm = school?.currentTerm ?? '';

  const assignments = await prisma.subjectAssignment.findMany({
    where: { schoolId, term: currentTerm },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      teacher: { select: { id: true, fullName: true } },
    },
    orderBy: [{ subject: { name: 'asc' } }],
  });

  const loadByTeacher = new Map<string, number>();
  for (const a of assignments) {
    loadByTeacher.set(a.teacherId, (loadByTeacher.get(a.teacherId) ?? 0) + 1);
  }
  const teachersWithLoad = teachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    assignmentCount: loadByTeacher.get(t.id) ?? 0,
  }));

  const assignmentsByClass = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByClass.get(a.classId) ?? [];
    list.push(a);
    assignmentsByClass.set(a.classId, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Subjects &amp; Class Assignments</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">
          Manage the school&apos;s subject pool and assign teachers to classes
        </p>
      </div>

      {/* Section 1 — Subject pool */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#292524]">School subjects</h2>
            <p className="text-sm text-[#78716c]">All subjects offered at this school</p>
          </div>
          <AddSubjectModal />
        </div>

        {subjects.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
            No subjects yet. Click &ldquo;+ Add Subject&rdquo; to create one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Code', 'Name', 'Max Mark', 'Type', 'Active', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {subjects.map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 font-mono text-xs text-[#78716c]">{s.code}</td>
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 tabular-nums">{s.maxMark}</td>
                    <td className="px-4 py-3">
                      <Badge label={s.type} variant={s.type === 'CORE' ? 'success' : 'neutral'} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={s.active ? 'Active' : 'Inactive'} variant={s.active ? 'success' : 'danger'} />
                    </td>
                    <td className="px-4 py-3">
                      <SubjectRowActions subject={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2 — Class assignments */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#292524]">
            Class assignments — {currentTerm || 'current term'}
          </h2>
          <p className="text-sm text-[#78716c]">Assign subjects and teachers to each class</p>
        </div>

        {classes.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
            No classes yet. Add classes under Admin → Classes first.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {classes.map((c) => {
              const classAssignments = assignmentsByClass.get(c.id) ?? [];
              const assignedSubjectIds = new Set(classAssignments.map((a) => a.subjectId));
              const availableSubjects = subjects.filter((s) => s.active && !assignedSubjectIds.has(s.id));

              return (
                <div key={c.id} className="rounded-xl border border-[#e7e5e4] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-[#292524]">{c.name}</h3>
                    <AssignSubjectModal
                      classId={c.id}
                      className={c.name}
                      term={currentTerm}
                      subjects={availableSubjects}
                      teachers={teachersWithLoad}
                    />
                  </div>

                  {classAssignments.length === 0 ? (
                    <p className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] px-4 py-6 text-center text-sm text-[#78716c]">
                      No subjects assigned to {c.name} yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-[#e7e5e4]">
                      <table className="w-full text-left text-sm text-[#292524]">
                        <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                          <tr>
                            {['Subject', 'Teacher assigned', ''].map((h) => (
                              <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e7e5e4] bg-white">
                          {classAssignments.map((a) => (
                            <tr key={a.id}>
                              <td className="px-4 py-3 font-medium">{a.subject.name} ({a.subject.code})</td>
                              <td className="px-4 py-3">{a.teacher.fullName}</td>
                              <td className="px-4 py-3">
                                <RemoveAssignmentButton id={a.id} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3 — Grade boundaries */}
      <section className="rounded-xl border border-[#e7e5e4] bg-white p-4">
        <GradeBoundariesManager />
      </section>
    </div>
  );
}
