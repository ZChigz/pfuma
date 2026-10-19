import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { ServiceError } from '@/lib/api';
import { analytics } from '@/lib/academics/analytics';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintBar } from '@/components/academics/PrintBar';

export const metadata = { title: 'Academic analytics · Pfuma' };

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

// A one-page A4 summary for staff meetings.
export default async function PrintAnalytics({ searchParams }: { searchParams: { termId?: string; formId?: string; classId?: string; departmentId?: string } }) {
  const { user, can } = await getAccess();
  if (!can('academics.analytics.view')) return <AccessDenied />;
  try {
    const [d, school] = await Promise.all([
      analytics(user, searchParams),
      getScopedDb(user.schoolId, user.id).school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } }),
    ]);
    return (
      <article className="mx-auto max-w-[190mm] text-[11px] leading-tight">
        <PrintBar title="Academic analytics summary" />
        <header className="mb-2 border-b-2 border-ink pb-1"><p className="text-sm font-bold">{school.name}</p><h1 className="text-lg font-bold">Academic summary — {d.term.name}</h1><p>Generated {d.generatedOn}{d.scope === 'DEPARTMENT' ? ' · department view' : ''}</p></header>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {d.attendance && (
            <section><h2 className="font-bold">Attendance (present %)</h2><p>Overall {pct(d.attendance.overall)}</p>
              <p>{d.attendance.byForm.map((f) => `${f.form} ${pct(f.rate)}`).join(' · ')}</p>
              <p className="text-muted">Weekly: {d.attendance.trend.map((t) => `W${t.week} ${pct(t.rate)}`).join(', ') || '—'}</p></section>
          )}
          {d.groups && (
            <section><h2 className="font-bold">By group</h2>
              <p>{[...d.groups.gender, ...d.groups.boarding].map((g) => `${g.group} ${pct(g.rate)}`).join(' · ')}</p>
              <p>{d.groups.dayOfWeek.map((g) => `${g.day.slice(0, 3)} ${pct(g.rate)}`).join(' · ')}</p></section>
          )}
          {d.chronic && (
            <section className="col-span-2"><h2 className="font-bold">Chronic absence ({d.chronic.length})</h2>
              <p>{d.chronic.slice(0, 14).map((s) => `${s.student} (${s.class}) ${pct(s.rate)}${s.streak >= 3 ? `, ${s.streak} in a row` : ''}`).join('; ') || 'None.'}{d.chronic.length > 14 ? ` … and ${d.chronic.length - 14} more` : ''}</p></section>
          )}
          {d.compliance && (
            <section className="col-span-2"><h2 className="font-bold">Register compliance (marked on the day)</h2>
              <p>{d.compliance.map((c) => `${c.class} ${pct(c.onTimePct)}`).join(' · ')}</p></section>
          )}
          <section><h2 className="font-bold">Syllabus coverage</h2>
            <p>{d.coverage.byDepartment.map((x) => `${x.name} ${pct(x.coverage)} (planned ${pct(x.plannedByNow)})`).join(' · ') || '—'}</p></section>
          <section><h2 className="font-bold">Schemes of work</h2>
            <p>Approved {d.schemes.counts.approved} · Submitted {d.schemes.counts.submitted} · Draft {d.schemes.counts.draft} · Not started {d.schemes.counts.none} · Late {d.schemes.counts.late}</p></section>
          <section className="col-span-2"><h2 className="font-bold">Teaching load (periods a week, maximum {d.load.maxPeriods})</h2>
            <p>{d.load.teachers.map((t) => `${t.name} ${t.periods}${t.status === 'over' ? ' (over)' : ''}${t.covers ? ` +${t.covers} cover` : ''}`).join(' · ')}</p></section>
          <section className="col-span-2"><h2 className="font-bold">Gaps</h2>
            <p>No teacher: {d.gaps.subjects.map((g) => `${g.subjectName} (${g.className})`).join(', ') || 'none'}.</p>
            <p>Not fully placed: {d.gaps.unplaced.map((u) => `${u.subject} ${u.target} ${u.placed}/${u.needed}`).join(', ') || 'none'}.</p></section>
        </div>
      </article>
    );
  } catch (err) {
    if (err instanceof ServiceError) return <p className="p-6">{err.message}</p>;
    throw err;
  }
}
