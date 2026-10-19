import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { timetableView } from '@/lib/academics/timetable';
import { getViewTerm } from '@/lib/system/view-term';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';
import { WeekGrid } from '@/components/academics/WeekGrid';

export const metadata = { title: 'Timetable · Pfuma' };

// A4 landscape: one class, one teacher, one room, or the whole school's master grid for the staff room.
export default async function PrintTimetable({ searchParams }: { searchParams: { view?: string; id?: string; version?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);
  const { term } = await getViewTerm(user.schoolId, db);
  const view = (['class', 'teacher', 'room', 'master'] as const).find((v) => v === searchParams.view) ?? 'master';
  if (!term) notFound();
  try {
    const [d, school] = await Promise.all([
      timetableView(user, { termId: term.id, view, id: searchParams.id, version: searchParams.version }),
      db.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } }),
    ]);
    return (
      <article>
        <PrintBar title={`Timetable: ${d.title}`} landscape />
        <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-ink pb-2">
          <div><p className="text-base font-bold">{school.name}</p><h1 className="text-xl font-bold">{d.title}</h1></div>
          <p className="text-sm">{d.term.name}{d.timetable ? ` · version ${d.timetable.version}${d.timetable.effectiveFrom ? `, from ${d.timetable.effectiveFrom}` : ''}${d.timetable.status === 'PUBLISHED' ? '' : ' · DRAFT'}` : ''}</p>
        </header>
        <WeekGrid days={d.days} cells={d.cells} view={view} dense />
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
