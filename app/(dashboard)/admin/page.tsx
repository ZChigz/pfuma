import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
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
import { ClassSizeSetting } from '@/components/admin/ClassSizeSetting';
import { getOpenTerm } from '@/lib/academic/terms';
import { cn } from '@/lib/utils';
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
  const db = getScopedDb(user.schoolId, user.id);

  await guardPage(user, 'system.users.view');
  const { schoolId } = user;

  const [school, openTerm] = await Promise.all([
    db.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } }),
    getOpenTerm(schoolId, db),
  ]);
  const term = openTerm?.name;
  const openTermId = openTerm?.id ?? '';

  const [totalUsers, totalStudents, totalSubjects, unplacedStudents, classes, recentUsers] = await Promise.all([
    db.user.count({ where: { schoolId, isSupport: false } }),
    db.student.count({ where: { schoolId, status: 'ACTIVE' } }),
    db.subject.count({ where: { schoolId } }),
    // Active students with no class in the open term.
    db.student.count({ where: { schoolId, status: 'ACTIVE', enrollments: { none: { termId: openTermId, status: 'ACTIVE' } } } }),
    db.schoolClass.findMany({
      where: { schoolId, active: true },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }],
      select: {
        id: true,
        name: true,
        classTeacherId: true,
        _count: { select: { enrollments: { where: { termId: openTermId, status: 'ACTIVE' } } } },
        assignments: { where: { termId: openTermId }, select: { id: true }, take: 1 },
      },
    }),
    db.user.findMany({
      where: { schoolId, isSupport: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, fullName: true, email: true, role: true, active: true },
    }),
  ]);

  const totalClasses = classes.length;
  const withoutTeacher = classes.filter((c) => !c.classTeacherId);
  const withoutSubjects = classes.filter((c) => c.assignments.length === 0);
  const setupPercent = totalClasses ? Math.round(((totalClasses - withoutSubjects.length) / totalClasses) * 100) : 0;

  const bars = classes.slice(0, 8).map((c) => ({ id: c.id, name: c.name, count: c._count.enrollments }));
  const maxCount = Math.max(1, ...bars.map((b) => b.count));
  const topId = bars.reduce<string | null>((best, b) => (b.count > 0 && (!best || b.count > (bars.find((x) => x.id === best)?.count ?? 0)) ? b.id : best), null);

  const nextSteps = [
    unplacedStudents > 0 && { text: `${unplacedStudents} student${unplacedStudents === 1 ? '' : 's'} not placed in a class`, href: '/admin/students', tone: 'bg-gold' },
    withoutTeacher.length > 0 && { text: `${withoutTeacher.length} class${withoutTeacher.length === 1 ? '' : 'es'} without a class teacher`, href: '/admin/classes', tone: 'bg-primary' },
    withoutSubjects.length > 0 && { text: `${withoutSubjects.length} class${withoutSubjects.length === 1 ? '' : 'es'} with no subjects assigned${term ? ` for ${term}` : ''}`, href: '/admin/classes', tone: 'bg-[#6ec99a]' },
  ].filter(Boolean) as TodoItem[];

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {term ? `${term}: ` : ''}who is enrolled, who teaches, and what still needs setting up.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/users" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2">
            <span aria-hidden="true" className="text-lg leading-none">+</span> Add user
          </Link>
          <Link href="/students" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary transition-colors hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2">
            Import students
          </Link>
        </div>
      </div>

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

      <Panel title="Settings">
        <ClassSizeSetting initial={school?.maxClassSize ?? 45} />
      </Panel>
    </div>
  );
}
