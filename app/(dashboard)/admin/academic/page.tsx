import { auth } from '@/lib/auth';
import { guardPage } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { isoDate } from '@/lib/academic/terms';
import { AcademicCalendar } from '@/components/admin/AcademicCalendar';
import type { SessionUser } from '@/types';

export default async function AcademicCalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await guardPage(user, 'system.settings.edit');

  const years = await db.academicYear.findMany({
    where: { schoolId: user.schoolId },
    include: {
      terms: {
        orderBy: { termNumber: 'asc' },
        include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      },
    },
    orderBy: { year: 'desc' },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Academic calendar</h1>
        <p className="mt-1 text-sm text-muted">
          Years and terms. Exactly one term is open at a time — it is the &ldquo;current term&rdquo; used for admissions, fees, marks and class lists.
        </p>
      </div>
      <AcademicCalendar
        years={years.map((y) => ({
          id: y.id,
          year: y.year,
          startDate: isoDate(y.startDate),
          endDate: isoDate(y.endDate),
          terms: y.terms.map((t) => ({
            id: t.id,
            name: t.name,
            termNumber: t.termNumber,
            status: t.status,
            startDate: isoDate(t.startDate),
            endDate: isoDate(t.endDate),
            students: t._count.enrollments,
          })),
        }))}
      />
    </div>
  );
}
