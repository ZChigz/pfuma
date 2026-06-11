import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { AddStudentModal } from '@/components/admin/AddStudentModal';
import { ImportStudentsModal } from '@/components/admin/ImportStudentsModal';
import { StudentsTable } from '@/components/admin/StudentsTable';
import { ClassFilter } from '@/components/admin/ClassFilter';
import { canManageStudents } from '@/lib/permissions';
import type { SessionUser } from '@/types';

interface Props {
  searchParams: { classId?: string };
}

export default async function AdminStudentsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch { redirect('/accounting'); }

  const classId = searchParams.classId ?? '';

  const [students, classes] = await Promise.all([
    prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        ...(classId ? { classId } : {}),
      },
      include: {
        class: { select: { id: true, name: true } },
      },
      orderBy: { fullName: 'asc' },
    }),
    prisma.schoolClass.findMany({
      where: { schoolId: user.schoolId },
      select: { id: true, name: true },
      orderBy: [{ grade: 'asc' }, { section: 'asc' }],
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Students</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Manage student records and class assignments</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportStudentsModal />
          <AddStudentModal classes={classes} defaultClassId={classId || undefined} />
        </div>
      </div>

      <ClassFilter classes={classes} value={classId} />

      <StudentsTable students={students} classes={classes} />
    </div>
  );
}
