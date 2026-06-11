import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { AddClassModal } from '@/components/admin/AddClassModal';
import { canManageClasses } from '@/lib/permissions';
import type { SessionUser } from '@/types';

export default async function AdminClassesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  try { await canManageClasses(user.role); } catch { redirect('/accounting'); }

  const [classes, teachers] = await Promise.all([
    prisma.schoolClass.findMany({
      where: { schoolId: user.schoolId },
      include: {
        classTeacher: { select: { id: true, fullName: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
    prisma.user.findMany({
      where: { schoolId: user.schoolId, role: 'TEACHER', active: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Classes</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">School class register</p>
        </div>
        <AddClassModal teachers={teachers} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
        <table className="w-full text-left text-sm text-[#292524]">
          <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
            <tr>
              {['Class Name', 'Grade/Stream', 'Section', 'Class Teacher', 'Students', 'Active'].map((h, i) => (
                <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7e5e4] bg-white">
            {classes.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-[#fafaf9]">
                <td className="px-4 py-3 font-medium">
                  <Link href={`/admin/classes/${c.id}`} className="text-[#065f46] hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3">{c.grade}</td>
                <td className="px-4 py-3">{c.section ?? '—'}</td>
                <td className="px-4 py-3">{c.classTeacher?.fullName ?? '—'}</td>
                <td className="px-4 py-3 tabular-nums">{c._count.students}</td>
                <td className="px-4 py-3">
                  <Badge label={c.active ? 'Active' : 'Inactive'} variant={c.active ? 'success' : 'danger'} />
                </td>
              </tr>
            ))}
            {classes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#78716c]">
                  No classes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
