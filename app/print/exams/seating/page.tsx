import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { seatingFor } from '@/lib/exams/invigilation';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Seating list · Pfuma' };

// The seating list of one paper: one page per room, for the door and for the desks. Candidates by candidate number (else admission number).
export default async function PrintSeating({ searchParams }: { searchParams: { paperId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.timetable.manage') && !can('exams.invigilation.manage') && !can('exams.timetable.approve') && !can('exams.marks.enter')) return <AccessDenied />;
  if (!searchParams.paperId) notFound();
  try {
    const [s, school] = await Promise.all([seatingFor(user, searchParams.paperId), getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } })]);
    return (
      <div>
        <PrintBar title={`Seating: ${s.paper}`} />
        {s.rooms.map((r) => (
          <article key={r.roomId} className="mx-auto mb-8 max-w-[190mm] break-after-page">
            <header className="mb-3 border-b border-ink pb-2">
              <p className="text-lg font-bold">{school.name}</p>
              <h1 className="text-2xl font-bold">{r.room}</h1>
              <p className="text-sm">{s.paper} · {s.date}, {s.startTime} to {s.endTime} · {s.period}</p>
              <p className="text-sm">Invigilators: {r.invigilators.length ? r.invigilators.join(', ') : '____________________'}</p>
            </header>
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b-2 border-ink text-left"><th className="w-14 py-1">Desk</th><th className="w-32 py-1">Candidate no.</th><th className="py-1">Name</th><th className="w-28 py-1">Class</th><th className="w-24 py-1">Present</th></tr></thead>
              <tbody>
                {r.seats.map((x) => (
                  <tr key={x.desk} className="border-b border-line"><td className="py-1.5 text-lg font-bold tabular-nums">{x.desk}</td><td className="py-1.5">{x.candidateNumber ?? x.admissionNumber}</td><td className="py-1.5">{x.name}</td><td className="py-1.5">{x.className ?? ''}</td><td className="py-1.5">&#9744;</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">{r.seats.length} candidates in this room. Printed from Pfuma.</p>
          </article>
        ))}
        {s.unseated.length > 0 && <p className="mx-auto max-w-[190mm] text-sm font-semibold text-danger">{s.unseated.length} candidate(s) have no seat yet: add rooms to this paper.</p>}
      </div>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
