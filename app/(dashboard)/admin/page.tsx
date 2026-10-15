import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
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

function ArrowButton({ light }: { light?: boolean }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
        light
          ? 'border-white/60 bg-white text-primary'
          : 'border-ink/70 text-ink group-hover:bg-primary group-hover:text-white group-hover:border-primary',
      )}
      aria-hidden="true"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17L17 7M8 7h9v9" />
      </svg>
    </span>
  );
}

function Panel({ title, action, className, children }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-2xl bg-white p-5', className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Half-ring gauge: filled arc = share of classes that are fully set up. */
function Gauge({ percent }: { percent: number }) {
  const r = 70;
  const arc = Math.PI * r;
  const filled = (percent / 100) * arc;
  return (
    <svg viewBox="0 0 180 100" className="mx-auto w-full max-w-[240px]" role="img" aria-label={`${percent}% of classes have subjects assigned`}>
      <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="#e3e9e4" strokeWidth="26" strokeLinecap="butt" />
      <path
        d="M20 90 A70 70 0 0 1 160 90"
        fill="none"
        stroke="#14613f"
        strokeWidth="26"
        strokeDasharray={`${filled} ${arc}`}
      />
      <text x="90" y="84" textAnchor="middle" className="fill-ink" style={{ fontSize: 30, fontWeight: 700 }}>
        {percent}%
      </text>
    </svg>
  );
}

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  if (!(['ADMIN', 'DIRECTOR'] as string[]).includes(user.role)) redirect('/');
  const { schoolId } = user;

  const [school, openTerm] = await Promise.all([
    db.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } }),
    getOpenTerm(schoolId, db),
  ]);
  const term = openTerm?.name;
  const openTermId = openTerm?.id ?? '';

  const [totalUsers, totalStudents, totalSubjects, unplacedStudents, classes, recentUsers] = await Promise.all([
    db.user.count({ where: { schoolId } }),
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

  const bars = classes.slice(0, 8).map((c) => ({ id: c.id, name: c.name, count: c._count.enrollments }));
  const maxCount = Math.max(1, ...bars.map((b) => b.count));
  const topId = bars.reduce<string | null>((best, b) => (b.count > 0 && (!best || b.count > (bars.find((x) => x.id === best)?.count ?? 0)) ? b.id : best), null);

  const nextSteps = [
    unplacedStudents > 0 && { text: `${unplacedStudents} student${unplacedStudents === 1 ? '' : 's'} not placed in a class`, href: '/admin/students', tone: 'bg-gold' },
    withoutTeacher.length > 0 && { text: `${withoutTeacher.length} class${withoutTeacher.length === 1 ? '' : 'es'} without a class teacher`, href: '/admin/classes', tone: 'bg-primary' },
    withoutSubjects.length > 0 && { text: `${withoutSubjects.length} class${withoutSubjects.length === 1 ? '' : 'es'} with no subjects assigned${term ? ` for ${term}` : ''}`, href: '/admin/classes', tone: 'bg-[#6ec99a]' },
  ].filter(Boolean) as { text: string; href: string; tone: string }[];

  const stats = [
    { label: 'Students enrolled', value: totalStudents, note: unplacedStudents ? `${unplacedStudents} not in a class` : 'All placed in classes', href: '/admin/students', hero: true },
    { label: 'Classes', value: totalClasses, note: withoutTeacher.length ? `${withoutTeacher.length} need a class teacher` : 'Every class has a teacher', href: '/admin/classes' },
    { label: 'Users', value: totalUsers, note: 'Staff with a login', href: '/admin/users' },
    { label: 'Subjects', value: totalSubjects, note: totalSubjects ? 'Ready to assign' : 'Add your first subject', href: '/admin/subjects' },
  ];

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
          <Link href="/admin/students" className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary transition-colors hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2">
            Import students
          </Link>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={cn(
              'group flex min-h-[148px] flex-col justify-between rounded-2xl p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
              s.hero ? 'term-card text-white' : 'bg-white text-ink',
            )}
          >
            <div className="relative flex items-start justify-between">
              <p className={cn('text-sm font-semibold', s.hero ? 'text-white' : 'text-ink')}>{s.label}</p>
              <ArrowButton light={s.hero} />
            </div>
            <div className="relative">
              <p className="text-5xl font-semibold tabular-nums leading-none tracking-tight">{s.value}</p>
              <p className={cn('mt-3 text-xs', s.hero ? 'text-emerald-100/90' : 'text-muted')}>{s.note}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr]">
        <Panel title="Students per class" className="lg:col-span-2 xl:col-span-1">
          {bars.length === 0 ? (
            <p className="py-10 text-sm text-muted">No classes yet. Add a class to start enrolling students.</p>
          ) : (
            <div className="flex h-[190px] items-end justify-between gap-2 sm:gap-3" role="list">
              {bars.map((b) => {
                const isTop = b.id === topId;
                const h = b.count === 0 ? 8 : Math.max(18, (b.count / maxCount) * 100);
                return (
                  <div key={b.id} role="listitem" className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${b.name}: ${b.count} students`}>
                    <span className={cn('text-xs font-semibold tabular-nums', isTop ? 'text-ink' : 'text-muted')}>{b.count}</span>
                    <div
                      className={cn('w-full max-w-[52px] rounded-full', isTop ? 'bg-[#0b3a25]' : b.count === 0 ? 'bg-line' : 'hatch')}
                      style={{ height: `${h}%` }}
                    />
                    <span className="w-full truncate text-center text-xs text-muted">{b.name}</span>
                  </div>
                );
              })}
            </div>
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
            <>
              <Gauge percent={setupPercent} />
              <p className="mt-2 text-center text-xs text-muted">
                of classes have subjects assigned{term ? ` for ${term}` : ''}
              </p>
              <ul className="mt-4 flex justify-center gap-4 text-xs text-muted">
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />Assigned</li>
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-line" aria-hidden="true" />Not yet</li>
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Still to do">
          {nextSteps.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nothing outstanding. Every student is in a class and every class has a teacher and subjects.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {nextSteps.map((n) => (
                <li key={n.text}>
                  <Link href={n.href} className="flex items-start gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                    <span className={cn('mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full', n.tone)} aria-hidden="true" />
                    <span className="text-sm leading-snug text-ink">{n.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* People */}
      <Panel
        title="Recently added users"
        action={
          <Link href="/admin/users" className="inline-flex min-h-[36px] items-center rounded-full border border-primary px-4 text-xs font-semibold text-primary transition-colors hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            Manage users
          </Link>
        }
      >
        {recentUsers.length === 0 ? (
          <p className="text-sm text-muted">No users yet. Add a teacher, bursar or head to get started.</p>
        ) : (
          <ul className="grid gap-x-8 md:grid-cols-2">
            {recentUsers.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tint text-sm font-semibold text-primary" aria-hidden="true">
                  {u.fullName.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{u.fullName}</p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </div>
                <Badge variant={u.active ? ROLE_BADGE[u.role as UserRole] : 'neutral'} label={u.active ? ROLE_LABELS[u.role as UserRole] : 'Inactive'} />
              </li>
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
