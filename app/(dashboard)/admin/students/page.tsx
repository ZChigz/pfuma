import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AddStudentModal } from '@/components/admin/AddStudentModal';
import { ImportStudentsModal } from '@/components/admin/ImportStudentsModal';
import { StudentsTable } from '@/components/admin/StudentsTable';
import { ClassFilter } from '@/components/admin/ClassFilter';
import { canManageStudents } from '@/lib/permissions';
import { getOpenTerm } from '@/lib/academic/terms';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';

interface Props {
  searchParams: { classId?: string };
}

export default async function AdminStudentsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageStudents(user.role); } catch { redirect('/accounting'); }

  const classId = searchParams.classId ?? '';
  const openTerm = await getOpenTerm(user.schoolId, db);
  const openTermId = openTerm?.id ?? '';

  const [students, classes] = await Promise.all([
    db.student.findMany({
      where: {
        schoolId: user.schoolId,
        // Filtering by class means "in that class this term" (Enrollment).
        ...(classId ? { enrollments: { some: { classId, termId: openTermId, status: 'ACTIVE' } } } : {}),
      },
      include: {
        currentClass: { select: { id: true, name: true } },
        guardians: PRIMARY_GUARDIAN_INCLUDE,
      },
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    }),
    db.schoolClass.findMany({
      where: { schoolId: user.schoolId, active: true },
      select: {
        id: true,
        name: true,
        stream: true,
        capacity: true,
        level: { select: { name: true } },
        _count: { select: { enrollments: { where: { termId: openTermId, status: 'ACTIVE' } } } },
      },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
    }),
  ]);

  const classOptions = classes.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level.name,
    stream: c.stream,
    capacity: c.capacity,
    studentCount: c._count.enrollments,
  }));

  const rows = students.map((s) => ({
    id: s.id,
    admissionNumber: s.admissionNumber,
    fullName: s.fullName,
    status: s.status,
    guardianName: s.guardians[0]?.guardian.fullName ?? '—',
    guardianPhone: s.guardians[0]?.guardian.phone ?? '—',
    class: s.currentClass,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Students</h1>
          <p className="mt-1 text-sm text-muted">
            Admissions, classes and leavers{openTerm ? ` — ${openTerm.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/promotions" className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-primary hover:underline">
            End-of-year promotions
          </Link>
          <ImportStudentsModal disabled={!openTerm} />
          <AddStudentModal classes={classOptions} disabled={!openTerm} />
        </div>
      </div>

      {!openTerm && (
        <p className="rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
          No term is open, so students cannot be admitted or moved. Open a term under{' '}
          <Link href="/admin/academic" className="font-medium underline">Academic calendar</Link>.
        </p>
      )}

      <ClassFilter classes={classOptions} value={classId} />

      <StudentsTable students={rows} classes={classOptions} />
    </div>
  );
}
