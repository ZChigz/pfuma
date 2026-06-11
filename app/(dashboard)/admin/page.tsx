import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import Link from 'next/link';
import type { SessionUser } from '@/types';

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  if (!(['ADMIN', 'DIRECTOR'] as string[]).includes(user.role)) redirect('/');

  const [totalUsers, totalClasses, totalStudents, totalSubjects, school] = await Promise.all([
    prisma.user.count({ where: { schoolId: user.schoolId } }),
    prisma.schoolClass.count({ where: { schoolId: user.schoolId } }),
    prisma.student.count({ where: { schoolId: user.schoolId, active: true } }),
    prisma.subject.count({ where: { schoolId: user.schoolId } }),
    prisma.school.findUnique({ where: { id: user.schoolId }, select: { currentTerm: true } }),
  ]);

  const cards = [
    { label: 'Total Users',         value: totalUsers,    href: '/admin/users' },
    { label: 'Total Classes',       value: totalClasses,  href: '/admin/classes' },
    { label: 'Total Students',      value: totalStudents, href: '/admin/students' },
    { label: 'Subjects Configured', value: totalSubjects, href: '/admin/subjects' },
  ];

  const hasEmptyCard = cards.some((c) => c.value === 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">School setup — {school?.currentTerm ?? 'Term not set'}</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">School-wide users, classes, students, and subjects</p>
      </div>

      {hasEmptyCard && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          No classes set up yet. Add classes before students can be enrolled.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card className="transition-shadow hover:shadow-md">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{c.label}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-[#292524]">{c.value}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
