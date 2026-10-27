import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { AddSubjectModal } from '@/components/admin/AddSubjectModal';
import { SubjectRowActions } from '@/components/admin/SubjectRowActions';
import { AssignSubjectModal } from '@/components/admin/AssignSubjectModal';
import { RemoveAssignmentButton } from '@/components/admin/RemoveAssignmentButton';
import { GradeBoundariesManager } from '@/components/results/GradeBoundariesManager';
import { ResultsSettings } from '@/components/results/ResultsSettings';
import { getOpenTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';

export default async function AdminSubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await guardPage(user, 'academics.subjects.manage');

  const { schoolId } = user;

  const [gradeLevels, gradeTerms] = await Promise.all([
    db.level.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
    db.academicTerm.findMany({ where: { schoolId }, select: { id: true, name: true }, orderBy: { startDate: 'desc' } }),
  ]);
  const resultsSchool = await db.school.findUnique({ where: { id: schoolId }, select: { passGrade: true, oLevelRanking: true } });

  const [subjects, classes, teachers, openTerm] = await Promise.all([
    db.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    }),
    db.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
    }),
    db.user.findMany({
      where: { schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    getOpenTerm(schoolId, db),
  ]);

  const currentTerm = openTerm?.name ?? '';

  const assignments = !openTerm ? [] : await db.subjectAssignment.findMany({
    where: { schoolId, termId: openTerm.id },
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Subjects &amp; Class Assignments</h1>
        <p className="mt-1 text-sm text-muted">
          Manage the school&apos;s subject pool and assign teachers to classes
        </p>
      </div>

      {/* Section 1 — Subject pool */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">School subjects</h2>
            <p className="text-sm text-muted">All subjects offered at this school</p>
          </div>
          <AddSubjectModal />
        </div>

        {subjects.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No subjects yet. Click &ldquo;+ Add Subject&rdquo; to create one.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Code', 'Name', 'Max Mark', 'Type', 'Active', ''].map((h) => (
                    <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {subjects.map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'opacity-60'}>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{s.code}</td>
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
          <h2 className="text-base font-semibold text-ink">
            Class assignments — {currentTerm || 'current term'}
          </h2>
          <p className="text-sm text-muted">Assign subjects and teachers to each class</p>
        </div>

        {classes.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No classes yet. Add classes under Admin → Classes first.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {classes.map((c) => {
              const classAssignments = assignmentsByClass.get(c.id) ?? [];
              const assignedSubjectIds = new Set(classAssignments.map((a) => a.subjectId));
              const availableSubjects = subjects.filter((s) => s.active && !assignedSubjectIds.has(s.id));

              return (
                <div key={c.id} className="rounded-2xl bg-white p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-ink">{c.name}</h3>
                    <AssignSubjectModal
                      classId={c.id}
                      className={c.name}
                      termId={openTerm?.id ?? ''}
                      termName={currentTerm}
                      subjects={availableSubjects}
                      teachers={teachersWithLoad}
                    />
                  </div>

                  {classAssignments.length === 0 ? (
                    <p className="rounded-xl border border-line bg-rowhover px-4 py-6 text-center text-sm text-muted">
                      No subjects assigned to {c.name} yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl bg-white">
                      <table className="w-full text-left text-sm text-ink">
                        <thead className="border-b border-line bg-white">
                          <tr>
                            {['Subject', 'Teacher assigned', ''].map((h) => (
                              <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line bg-white">
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
      <section className="rounded-2xl bg-white p-5">
        <GradeBoundariesManager levels={gradeLevels} terms={gradeTerms} />
      </section>

      <ResultsSettings passGrade={resultsSchool?.passGrade ?? 'C'} oLevelRanking={resultsSchool?.oLevelRanking ?? 'AVERAGE'} />
    </div>
  );
}
