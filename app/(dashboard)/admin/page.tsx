import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { StatCard } from '@/components/ui/StatCard';
import {
  ChartRow,
  DashboardHeader,
  Gauge,
  Panel,
  PersonRow,
  PillBars,
  PrimaryLink,
  SecondaryLink,
  SmallLink,
  StatRow,
  TodoList,
  type TodoItem,
} from '@/components/dashboard/parts';
import { ROLE_LABELS } from '@/components/layout/nav-config';
import type { SessionUser, UserRole } from '@/types';

const ROLE_BADGE: Record<UserRole, BadgeVariant> = {
  ADMIN: 'gold',
  DIRECTOR: 'info',
  HEAD: 'info',
  BURSAR: 'warning',
  TEACHER: 'success',
  LIBRARIAN: 'neutral',
};

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  if (!(['ADMIN', 'DIRECTOR'] as string[]).includes(user.role)) redirect('/');
  const { schoolId } = user;

  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { currentTerm: true } });
  const term = school?.currentTerm ?? undefined;

  const [totalUsers, totalStudents, totalSubjects, unplacedStudents, classes, recentUsers] = await Promise.all([
    prisma.user.count({ where: { schoolId } }),
    prisma.student.count({ where: { schoolId, active: true } }),
    prisma.subject.count({ where: { schoolId } }),
    prisma.student.count({ where: { schoolId, active: true, classId: null } }),
    prisma.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        classTeacherId: true,
        _count: { select: { students: { where: { active: true } } } },
        assignments: { where: term ? { term } : {}, select: { id: true }, take: 1 },
      },
    }),
    prisma.user.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, fullName: true, email: true, role: true, active: true },
    }),
  ]);

  const totalClasses = classes.length;
  const withoutTeacher = classes.filter((c) => !c.classTeacherId);
  const withoutSubjects = classes.filter((c) => c.assignments.length === 0);
  const setupPercent = totalClasses ? Math.round(((totalClasses - withoutSubjects.length) / totalClasses) * 100) : 0;

  const bars = classes.slice(0, 8).map((c) => ({ id: c.id, name: c.name, count: c._count.students }));

  const nextSteps = [
    unplacedStudents > 0 && { text: `${unplacedStudents} student${unplacedStudents === 1 ? '' : 's'} not placed in a class`, href: '/admin/students', tone: 'bg-gold' },
    withoutTeacher.length > 0 && { text: `${withoutTeacher.length} class${withoutTeacher.length === 1 ? '' : 'es'} without a class teacher`, href: '/admin/classes', tone: 'bg-primary' },
    withoutSubjects.length > 0 && { text: `${withoutSubjects.length} class${withoutSubjects.length === 1 ? '' : 'es'} with no subjects assigned${term ? ` for ${term}` : ''}`, href: '/admin/classes', tone: 'bg-[#6ec99a]' },
  ].filter(Boolean) as TodoItem[];

  return (
    <div className="flex flex-col gap-4 pb-2">
      <DashboardHeader
        subtitle={`${term ? `${term}: ` : ''}who is enrolled, who teaches, and what still needs setting up.`}
        actions={
          <>
            <PrimaryLink href="/admin/users"><span aria-hidden="true" className="text-lg leading-none">+</span> Add user</PrimaryLink>
            <SecondaryLink href="/admin/students">Import students</SecondaryLink>
          </>
        }
      />

      <StatRow>
        <StatCard hero label="Students enrolled" value={totalStudents} note={unplacedStudents ? `${unplacedStudents} not in a class` : 'All placed in classes'} href="/admin/students" />
        <StatCard label="Classes" value={totalClasses} note={withoutTeacher.length ? `${withoutTeacher.length} need a class teacher` : 'Every class has a teacher'} href="/admin/classes" />
        <StatCard label="Users" value={totalUsers} note="Staff with a login" href="/admin/users" />
        <StatCard label="Subjects" value={totalSubjects} note={totalSubjects ? 'Ready to assign' : 'Add your first subject'} href="/admin/subjects" />
      </StatRow>

      <ChartRow>
        <Panel title="Students per class" className="lg:col-span-2 xl:col-span-1">
          {bars.length === 0 ? (
            <p className="py-10 text-sm text-muted">No classes yet. Add a class to start enrolling students.</p>
          ) : (
            <PillBars bars={bars} unit="students" />
          )}
          {classes.length > bars.length && (
            <Link href="/admin/classes" className="mt-3 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">
              Show all {classes.length} classes
            </Link>
          )}
        </Panel>

        <Panel title="Subject setup">
          {totalClasses === 0 ? (
            <p className="py-10 text-sm text-muted">Add classes to track subject setup.</p>
          ) : (
            <Gauge
              percent={setupPercent}
              caption={`of classes have subjects assigned${term ? ` for ${term}` : ''}`}
              filledLabel="Assigned"
              emptyLabel="Not yet"
            />
          )}
        </Panel>

        <Panel title="Still to do">
          <TodoList items={nextSteps} emptyText="Nothing outstanding. Every student is in a class and every class has a teacher and subjects." />
        </Panel>
      </ChartRow>

      <Panel title="Recently added users" action={<SmallLink href="/admin/users">Manage users</SmallLink>}>
        {recentUsers.length === 0 ? (
          <p className="text-sm text-muted">No users yet. Add a teacher, bursar or head to get started.</p>
        ) : (
          <ul className="grid gap-x-8 md:grid-cols-2">
            {recentUsers.map((u) => (
              <PersonRow
                key={u.id}
                name={u.fullName}
                detail={u.email}
                badge={<Badge variant={u.active ? ROLE_BADGE[u.role as UserRole] : 'neutral'} label={u.active ? ROLE_LABELS[u.role as UserRole] : 'Inactive'} />}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
