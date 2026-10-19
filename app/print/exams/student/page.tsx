import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { studentTimetable } from '@/lib/exams/timetable';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Student exam timetable · Pfuma' };

// One student's own papers, with their room and desk.
export default async function PrintStudentTimetable({ searchParams }: { searchParams: { periodId?: string; studentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.timetable.manage') && !can('exams.timetable.approve') && !can('exams.invigilation.manage') && !can('exams.results.view')) return <AccessDenied />;
  if (!searchParams.periodId || !searchParams.studentId) notFound();
  try {
    const [t, school] = await Promise.all([studentTimetable(user, searchParams.periodId, searchParams.studentId), getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } })]);
    return (
      <article className="mx-auto max-w-[190mm]">
        <PrintBar title={`Exam timetable: ${t.student}`} />
        <header className="mb-3 border-b border-ink pb-2">
          <p className="text-lg font-bold">{school.name}</p>
          <h1 className="text-xl font-bold">{t.period}</h1>
          <p className="text-sm">{t.student}{t.className ? ` · ${t.className}` : ''}</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-ink text-left"><th className="w-28 py-1">Date</th><th className="py-1">Paper</th><th className="w-32 py-1">Time</th><th className="w-32 py-1">Room</th><th className="w-14 py-1">Desk</th></tr></thead>
          <tbody>{t.papers.map((p) => <tr key={p.paperId} className="border-b border-line"><td className="py-1.5">{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${p.date}T00:00:00Z`))}</td><td className="py-1.5 font-semibold">{p.name}</td><td className="py-1.5">{p.startTime} to {p.endTime}</td><td className="py-1.5">{p.room ?? ''}</td><td className="py-1.5 font-bold">{p.desk ?? ''}</td></tr>)}</tbody>
        </table>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
