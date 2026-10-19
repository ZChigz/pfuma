import { notFound } from 'next/navigation';
import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { entryList } from '@/lib/exams/board';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Entry summary · Pfuma' };

// The printed summary by subject for the centre's records: the number of candidates per subject code.
export default async function PrintBoardSummary({ searchParams }: { searchParams: { sessionId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('exams.zimsec.manage') && !can('exams.zimsec.approve')) return <AccessDenied />;
  if (!searchParams.sessionId) notFound();
  try {
    const [l, school] = await Promise.all([entryList(user, searchParams.sessionId), getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } })]);
    const s = l.session;
    return (
      <article className="mx-auto max-w-[190mm]">
        <PrintBar title={`${s.board} ${s.session} entry summary`} />
        <header className="mb-3 border-b border-ink pb-2">
          <p className="text-lg font-bold">{school.name}</p>
          <h1 className="text-xl font-bold">{s.board} {s.session}: entries by subject</h1>
          <p className="text-sm">Centre number {s.centreNumber} · {s.category === 'O_LEVEL' ? 'O Level' : 'A Level'} · {l.totals.candidates} candidates · {s.status === 'APPROVED' ? `entry list approved ${s.approvedAt?.slice(0, 10)}` : 'entry list NOT yet approved'}</p>
        </header>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="border-b-2 border-ink text-left"><th className="w-28 py-1">Subject code</th><th className="py-1">Subject</th><th className="w-32 py-1 text-right">Candidates</th></tr></thead>
          <tbody>
            {l.summary.map((r) => <tr key={r.code} className="border-b border-line"><td className="py-1.5 font-semibold">{r.code}</td><td className="py-1.5">{r.subject}</td><td className="py-1.5 text-right tabular-nums">{r.candidates}</td></tr>)}
            <tr className="border-t-2 border-ink font-bold"><td className="py-1.5" colSpan={2}>Total entries</td><td className="py-1.5 text-right tabular-nums">{l.summary.reduce((a, r) => a + r.candidates, 0)}</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-sm">Fees: {s.currency} {l.totals.feeTotal.toFixed(2)} due, {s.currency} {l.totals.feeCollected.toFixed(2)} paid, {l.totals.unpaid} candidate(s) unpaid.</p>
        <p className="mt-6 text-sm">Exams Officer: ____________________ Head: ____________________ Date: ____________</p>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
}
