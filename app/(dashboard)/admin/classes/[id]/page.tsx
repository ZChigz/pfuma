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
        <Link href="/admin/classes" className="text-sm text-[#14613f] hover:underline">
          ← Back to Classes
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#14301f]">{schoolClass.name}</h1>
          <p className="mt-0.5 text-sm text-[#6b7a70]">
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
          <h2 className="text-lg font-semibold text-[#14301f]">Students ({schoolClass.students.length})</h2>
          <Link href={`/admin/students?classId=${schoolClass.id}`} className="text-sm font-medium text-[#14613f] hover:underline">
            Manage Students →
          </Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
          <table className="w-full text-left text-sm text-[#14301f]">
            <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
              <tr>
                {['Name', 'Parent/Guardian', 'Phone', 'Active'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-xs font-semibold   text-[#6b7a70]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e3e9e4] bg-white">
              {schoolClass.students.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">{s.fullName}</td>
                  <td className="px-4 py-3">{s.parentName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#6b7a70]">{s.parentPhone}</td>
                  <td className="px-4 py-3">
                    <Badge label={s.active ? 'Active' : 'Inactive'} variant={s.active ? 'success' : 'danger'} />
                  </td>
                </tr>
              ))}
              {schoolClass.students.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-[#6b7a70]">
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
