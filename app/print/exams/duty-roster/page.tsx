import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { dutyRoster } from '@/lib/exams/invigilation';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Invigilation roster · Pfuma' };

// The duty roster for the staff room, by day and session.
export default async function PrintDutyRoster({ searchParams }: { searchParams: { periodId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.invigilation.manage') && !can('exams.timetable.manage') && !can('exams.timetable.approve')) return <AccessDenied />;
  if (!searchParams.periodId) notFound();
  try {
    const [r, school] = await Promise.all([dutyRoster(user, searchParams.periodId), getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } })]);
    const slots = Array.from(new Set(r.duties.map((d) => `${d.date}|${d.session}`)));
    return (
      <article className="mx-auto max-w-[190mm]">
        <PrintBar title={`Invigilation roster: ${r.period}`} />
        <header className="mb-3 border-b border-ink pb-2">
          <p className="text-lg font-bold">{school.name}</p>
          <h1 className="text-xl font-bold">Invigilation roster: {r.period}</h1>
        </header>
        {slots.map((slot) => {
          const [date, session] = slot.split('|');
          const list = r.duties.filter((d) => d.date === date && d.session === session);
          return (
            <section key={slot} className="mb-5 break-inside-avoid">
              <h2 className="mb-1 text-sm font-bold">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}, {session === 'MORNING' ? 'morning' : 'afternoon'}</h2>
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b-2 border-ink text-left"><th className="w-44 py-1">Paper</th><th className="w-28 py-1">Time</th><th className="w-36 py-1">Room</th><th className="py-1">Invigilator</th><th className="w-28 py-1">Signature</th></tr></thead>
                <tbody>{list.map((d) => <tr key={d.id} className="border-b border-line"><td className="py-1.5">{d.paper}</td><td className="py-1.5">{d.startTime} to {d.endTime}</td><td className="py-1.5">{d.room}</td><td className="py-1.5 font-semibold">{d.teacher}</td><td className="py-1.5" /></tr>)}</tbody>
              </table>
            </section>
          );
        })}
        {r.missing.length > 0 && <p className="text-sm font-semibold text-danger">No invigilator yet: {r.missing.map((m) => `${m.paper} (${m.room})`).join(', ')}</p>}
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
