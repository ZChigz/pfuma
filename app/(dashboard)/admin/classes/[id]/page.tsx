import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { EditClassModal } from '@/components/admin/EditClassModal';
import { canManageClasses } from '@/lib/permissions';
import { getOpenTerm } from '@/lib/academic/terms';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';

interface Props {
  params: { id: string };
}

export default async function AdminClassDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageClasses(user.role); } catch { redirect('/accounting'); }

  const openTerm = await getOpenTerm(user.schoolId, db);
  const [schoolClass, teachers, levels] = await Promise.all([
    db.schoolClass.findUnique({
      where: { id: params.id },
      include: {
        level: { select: { name: true } },
        classTeacher: { select: { id: true, fullName: true } },
        _count: { select: { enrollments: true } },
        // The roster for the open term, from Enrollment.
        enrollments: {
          where: { termId: openTerm?.id ?? '', status: 'ACTIVE' },
          include: { student: { select: { id: true, admissionNumber: true, fullName: true, status: true, guardians: PRIMARY_GUARDIAN_INCLUDE } } },
          orderBy: { student: { fullName: 'asc' } },
        },
      },
    }),
    db.user.findMany({
      where: { schoolId: user.schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
    db.level.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
  ]);

  if (!schoolClass || schoolClass.schoolId !== user.schoolId) notFound();
  const students = schoolClass.enrollments.map((e) => ({
    ...e.student,
    guardianName: e.student.guardians[0]?.guardian.fullName ?? '—',
    guardianPhone: e.student.guardians[0]?.guardian.phone ?? '—',
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/classes" className="text-sm text-primary hover:underline">
          ← Back to Classes
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{schoolClass.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {schoolClass.level.name}{schoolClass.stream ? ` · ${schoolClass.stream} stream` : ''} · Capacity {schoolClass.capacity}
            {' · '}Class Teacher: {schoolClass.classTeacher?.fullName ?? 'Unassigned'}
            {' · '}
            <Badge label={schoolClass.active ? 'Active' : 'Inactive'} variant={schoolClass.active ? 'success' : 'danger'} />
          </p>
        </div>
        <EditClassModal
          schoolClass={{
            id: schoolClass.id,
            levelId: schoolClass.levelId,
            stream: schoolClass.stream,
            capacity: schoolClass.capacity,
            classTeacherId: schoolClass.classTeacherId,
            active: schoolClass.active,
            hasHistory: schoolClass._count.enrollments > 0,
          }}
          teachers={teachers}
          levels={levels}
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Students in {openTerm?.name ?? 'the current term'} ({students.length})</h2>
          <Link href={`/students?classId=${schoolClass.id}`} className="text-sm font-medium text-primary hover:underline">
            Manage Students →
          </Link>
        </div>
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Admission No.', 'Name', 'Guardian', 'Phone'].map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {students.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{s.admissionNumber}</td>
                  <td className="px-4 py-3 font-medium">{s.fullName}</td>
                  <td className="px-4 py-3">{s.guardianName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{s.guardianPhone}</td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                    No students in this class yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
