import { getAccess } from '@/lib/access';
import { coverList } from '@/lib/academics/timetable';
import { todayInHarare } from '@/lib/academics/common';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Cover list · Pfuma' };

// The daily cover list for the staff room.
export default async function PrintCover({ searchParams }: { searchParams: { date?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.timetable.view')) return <AccessDenied />;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : todayInHarare();
  const d = await coverList(user, date);
  return (
    <article className="mx-auto max-w-[190mm]">
      <PrintBar title={`Cover list for ${date}`} />
      <header className="mb-4 border-b border-ink pb-2">
        <p className="text-base font-bold">{d.school}</p>
        <h1 className="text-xl font-bold">Cover lessons — {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))}</h1>
      </header>
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b-2 border-ink text-left"><th className="py-1">Period</th><th>Time</th><th>Class</th><th>Subject</th><th>Room</th><th>Absent</th><th>Cover teacher</th></tr></thead>
        <tbody>
          {d.rows.length === 0 && <tr><td colSpan={7} className="py-4 text-center">No cover lessons.</td></tr>}
          {d.rows.map((r) => (
            <tr key={r.id} className="border-b border-line"><td className="py-1.5">{r.periodNo}</td><td>{r.start}–{r.end}</td><td>{r.target}</td><td>{r.subject}</td><td>{r.room ?? ''}</td><td>{r.absent}</td><td className="font-semibold">{r.cover}</td></tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
