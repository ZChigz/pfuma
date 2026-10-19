import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { getPeriod } from '@/lib/exams/timetable';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Exam timetable · Pfuma' };

// The approved exam timetable on A4, one page per form: date, session, paper, time and rooms.
export default async function PrintExamTimetable({ searchParams }: { searchParams: { periodId?: string; levelId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.timetable.manage') && !can('exams.timetable.approve') && !can('exams.invigilation.manage') && !can('exams.marks.enter')) return <AccessDenied />;
  if (!searchParams.periodId) notFound();
  try {
    const [d, school] = await Promise.all([getPeriod(user, searchParams.periodId), getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } })]);
    if (d.period.status !== 'APPROVED') return <AccessDenied message="Only an approved exam timetable is printed." />;
    const levels = d.period.levels.filter((l) => !searchParams.levelId || l.id === searchParams.levelId);
    return (
      <div>
        <PrintBar title={`Exam timetable: ${d.period.name}`} />
        {levels.map((l) => (
          <article key={l.id} className="mx-auto mb-8 max-w-[190mm] break-after-page">
            <header className="mb-3 border-b border-ink pb-2">
              <p className="text-lg font-bold">{school.name}</p>
              <h1 className="text-xl font-bold">{d.period.name}: {l.name}</h1>
              <p className="text-sm">{d.period.startDate} to {d.period.endDate}</p>
            </header>
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b-2 border-ink text-left"><th className="w-28 py-1">Date</th><th className="w-24 py-1">Session</th><th className="py-1">Paper</th><th className="w-32 py-1">Time</th><th className="w-40 py-1">Rooms</th></tr></thead>
              <tbody>
                {d.papers.filter((p) => p.levelId === l.id).map((p) => (
                  <tr key={p.id} className="border-b border-line">
                    <td className="py-1.5">{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${p.date}T00:00:00Z`))}</td>
                    <td className="py-1.5">{p.session === 'MORNING' ? 'Morning' : 'Afternoon'}</td><td className="py-1.5 font-semibold">{p.name}</td><td className="py-1.5">{p.startTime} to {p.endTime}</td><td className="py-1.5">{p.rooms.map((r) => r.room).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-muted">Be at your desk 15 minutes before the start. Printed from Pfuma.</p>
          </article>
        ))}
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
