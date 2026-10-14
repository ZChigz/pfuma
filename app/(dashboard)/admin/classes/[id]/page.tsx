import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { EditClassModal } from '@/components/admin/EditClassModal';
import { canManageClasses } from '@/lib/permissions';
import type { SessionUser } from '@/types';

interface Props {
  params: { id: string };
}

export default async function AdminClassDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch { redirect('/accounting'); }

  const [schoolClass, teachers] = await Promise.all([
    prisma.schoolClass.findUnique({
      where: { id: params.id },
      include: {
        classTeacher: { select: { id: true, fullName: true } },
        students: {
          select: { id: true, fullName: true, parentName: true, parentPhone: true, active: true },
          orderBy: { fullName: 'asc' },
        },
      },
    }),
    prisma.user.findMany({
      where: { schoolId: user.schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  if (!schoolClass || schoolClass.schoolId !== user.schoolId) notFound();

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
            {schoolClass.grade}{schoolClass.section ? ` · Section ${schoolClass.section}` : ''}
            {' · '}Class Teacher: {schoolClass.classTeacher?.fullName ?? 'Unassigned'}
            {' · '}
            <Badge label={schoolClass.active ? 'Active' : 'Inactive'} variant={schoolClass.active ? 'success' : 'danger'} />
          </p>
        </div>
        <EditClassModal
          schoolClass={{
            id: schoolClass.id,
            grade: schoolClass.grade,
            section: schoolClass.section,
            classTeacherId: schoolClass.classTeacherId,
            active: schoolClass.active,
          }}
          teachers={teachers}
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Students ({schoolClass.students.length})</h2>
          <Link href={`/admin/students?classId=${schoolClass.id}`} className="text-sm font-medium text-primary hover:underline">
            Manage Students →
          </Link>
        </div>
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Name', 'Parent/Guardian', 'Phone', 'Active'].map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {schoolClass.students.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.fullName}</td>
                  <td className="px-4 py-3">{s.parentName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{s.parentPhone}</td>
                  <td className="px-4 py-3">
                    <Badge label={s.active ? 'Active' : 'Inactive'} variant={s.active ? 'success' : 'danger'} />
                  </td>
                </tr>
              ))}
              {schoolClass.students.length === 0 && (
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
