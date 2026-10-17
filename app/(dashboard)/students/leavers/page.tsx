import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { EXIT_REASONS, LEAVERS_PAGE_SIZE, listLeavers } from '@/lib/students/leavers';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { LeaversClient } from '@/components/students/LeaversAlumniClients';

export const metadata = { title: 'Leavers · Pfuma' };

export default async function LeaversPage({ searchParams }: { searchParams: { year?: string; reason?: string; classId?: string; page?: string } }) {
  const { user, can } = await getAccess();
  if (!can('students.leavers.manage')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const year = Number(searchParams.year) || undefined;
  const reason = (EXIT_REASONS as readonly string[]).includes(searchParams.reason ?? '') ? (searchParams.reason as (typeof EXIT_REASONS)[number]) : undefined;
  const page = Math.max(1, Number(searchParams.page) || 1);
  const [list, classes, lastDays] = await Promise.all([
    listLeavers(user, { year, reason, classId: searchParams.classId || undefined, page }),
    db.schoolClass.findMany({ orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true } }),
    db.studentExit.findMany({ where: { state: 'COMPLETED' }, distinct: ['lastDay'], select: { lastDay: true } }),
  ]);
  const years = Array.from(new Set(lastDays.map((d) => d.lastDay.getUTCFullYear()))).sort((a, b) => b - a);
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Leavers" description="Everyone who left, with their letters. A student who left can be re-admitted from their profile." breadcrumbs={[{ label: 'Student Information' }, { label: 'Leavers' }]} />
      <LeaversClient rows={list.rows} total={list.total} page={page} pageSize={LEAVERS_PAGE_SIZE} years={years} classes={classes} />
    </div>
  );
}
