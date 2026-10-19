import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { ServiceError } from '@/lib/api';
import { attendanceSheet } from '@/lib/exams/invigilation';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Exam attendance sheet · Pfuma' };

// A blank attendance sheet for one paper and room, to mark by hand at the door.
export default async function PrintExamAttendance({ searchParams }: { searchParams: { paperId?: string; roomId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.marks.enter') && !can('exams.invigilation.manage') && !can('exams.timetable.manage') && !can('exams.timetable.approve')) return <AccessDenied />;
  if (!searchParams.paperId || !searchParams.roomId) notFound();
  try {
    const s = await attendanceSheet(user, searchParams.paperId, searchParams.roomId);
    return (
      <article className="mx-auto max-w-[190mm]">
        <PrintBar title={`Attendance: ${s.paper}`} />
        <header className="mb-3 border-b border-ink pb-2">
          <h1 className="text-xl font-bold">{s.paper}: {s.room}</h1>
          <p className="text-sm">{s.date} · {s.session === 'MORNING' ? 'morning' : 'afternoon'} · {s.rows.length} candidates</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-ink text-left"><th className="w-12 py-1">Desk</th><th className="w-32 py-1">Candidate no.</th><th className="py-1">Name</th><th className="w-20 py-1">Present</th><th className="w-20 py-1">Absent</th><th className="w-28 py-1">Late (time)</th></tr></thead>
          <tbody>{s.rows.map((r) => <tr key={r.studentId} className="border-b border-line"><td className="py-1.5 font-bold tabular-nums">{r.desk}</td><td className="py-1.5">{r.candidateNumber ?? r.admissionNumber}</td><td className="py-1.5">{r.name}</td><td className="py-1.5">&#9744;</td><td className="py-1.5">&#9744;</td><td className="py-1.5">&#9744; ____:____</td></tr>)}</tbody>
        </table>
        <p className="mt-6 text-sm">Invigilator: ______________________ Signature: ______________ Time collected: ________</p>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
