'use client';

// The Head's weekly page: attendance, chronic absence, register compliance, coverage, scheme compliance, teaching load and gaps.
// Filters: form, class, department (the term is the one in the top bar). Every panel exports to CSV; the page prints on one A4.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Section, Td, Th, linkButton } from '@/components/academics/shared';
import type { AnalyticsData } from '@/lib/academics/analytics';

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

function Trend({ points }: { points: { week: number; rate: number | null }[] }) {
  const pts = points.filter((p) => p.rate !== null) as { week: number; rate: number }[];
  if (pts.length < 2) return <p className="text-sm text-muted">The trend appears after two weeks of registers.</p>;
  const w = 320, h = 90, lo = Math.min(...pts.map((p) => p.rate), 80), x = (i: number) => (i / (pts.length - 1)) * (w - 20) + 10, y = (r: number) => h - 10 - ((r - lo) / (100 - lo)) * (h - 20);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Weekly present %, from ${pts[0]!.rate}% to ${pts.at(-1)!.rate}%`} className="w-full max-w-md">
      <polyline fill="none" stroke="#14613f" strokeWidth="2.5" points={pts.map((p, i) => `${x(i)},${y(p.rate)}`).join(' ')} />
      {pts.map((p, i) => <g key={p.week}><circle cx={x(i)} cy={y(p.rate)} r="3.5" fill="#14613f" /><text x={x(i)} y={h - 1} fontSize="9" textAnchor="middle" fill="#6b7a70">W{p.week}</text></g>)}
    </svg>
  );
}

export function AnalyticsClient({ data, canExport, query }: { data: AnalyticsData; canExport: boolean; query: { formId?: string; classId?: string; departmentId?: string } }) {
  const router = useRouter();
  const go = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ ...(query.formId ? { formId: query.formId } : {}), ...(query.classId ? { classId: query.classId } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...patch });
    for (const [k, v] of Array.from(q)) if (!v) q.delete(k);
    router.push(`?${q}`);
  };
  const qs = new URLSearchParams({ termId: data.term.id, ...(query.formId ? { formId: query.formId } : {}), ...(query.classId ? { classId: query.classId } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}) }).toString();
  const exp = (panel: string) => canExport && <a href={`/api/academics/analytics/export?panel=${panel}&${qs}`} className="text-sm font-semibold text-primary hover:underline">Export CSV</a>;
  const school = data.scope === 'SCHOOL';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {school && <div className="w-44"><Select id="an-form" label="Form" value={query.formId ?? ''} onChange={(e) => go({ formId: e.target.value, classId: '' })} placeholder="All forms" options={data.options.forms.map((f) => ({ value: f.id, label: f.name }))} /></div>}
        {school && <div className="w-52"><Select id="an-class" label="Class" value={query.classId ?? ''} onChange={(e) => go({ classId: e.target.value })} placeholder="All classes" options={data.options.classes.filter((c) => !query.formId || c.formId === query.formId).map((c) => ({ value: c.id, label: c.name }))} /></div>}
        <div className="w-56"><Select id="an-dept" label="Department" value={query.departmentId ?? ''} onChange={(e) => go({ departmentId: e.target.value })} placeholder={school ? 'All departments' : 'My department'} options={data.options.departments.map((d) => ({ value: d.id, label: d.name }))} /></div>
        <Link href={`/print/academics/analytics?${qs}`} target="_blank" className={linkButton}>Print one page (A4)</Link>
      </div>
      <p className="text-sm text-muted">{data.term.name} · {data.schoolDays} school days so far{school ? '' : ' · department view'}</p>

      {data.attendance && (
        <Section title="Attendance rate" hint={`Present % this term${data.attendance.overall === null ? '' : `: ${data.attendance.overall}% overall`}. Late counts as present; excused counts as absent.`} action={exp('attendance')}>
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">By form</h3>
              <ul className="space-y-1.5">{data.attendance.byForm.length === 0 && <li className="text-sm text-muted">No registers yet.</li>}{data.attendance.byForm.map((f) => (
                <li key={f.id}><div className="flex justify-between text-sm"><span>{f.form}</span><b className={f.rate !== null && f.rate < data.attendance!.threshold ? 'text-danger' : ''}>{pct(f.rate)}</b></div><div className="h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full bg-primary" style={{ width: `${f.rate ?? 0}%` }} /></div></li>
              ))}</ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-ink">By class</h3>
              <ul className="space-y-1 text-sm">{data.attendance.byClass.map((c) => <li key={c.id} className="flex justify-between"><Link href={`/academics/classes/${c.id}`} className="text-primary hover:underline">{c.class}</Link><b className={c.rate !== null && c.rate < data.attendance!.threshold ? 'text-danger' : ''}>{pct(c.rate)}</b></li>)}</ul>
            </div>
            <div><h3 className="mb-1 text-sm font-semibold text-ink">Trend by week</h3><Trend points={data.attendance.trend} /></div>
          </div>
        </Section>
      )}

      {data.chronic && (
        <Section title={`Chronic absence (${data.chronic.length})`} hint={`Below ${data.attendance?.threshold ?? 90}% attendance, or absent several days in a row.`} action={exp('chronic')}>
          <div className="overflow-x-auto"><table className="min-w-full divide-y divide-line"><caption className="sr-only">Students with chronic absence</caption>
            <thead><tr><Th>Student</Th><Th>Class</Th><Th className="text-right">Attendance</Th><Th className="text-right">In a row</Th><Th>Guardian</Th></tr></thead>
            <tbody className="divide-y divide-line">{data.chronic.length === 0 && <tr><Td className="text-success">Nobody is below the threshold.</Td></tr>}{data.chronic.map((s) => (
              <tr key={s.studentId}><Td className="font-semibold"><Link href={`/students/${s.studentId}`} className="text-primary hover:underline">{s.student}</Link></Td><Td>{s.class}</Td><Td className="text-right tabular-nums">{pct(s.rate)}</Td><Td className="text-right tabular-nums">{s.streak}</Td><Td>{s.guardianPhone ? <a className="text-primary hover:underline" href={`tel:${s.guardianPhone}`}>{s.guardian} · {s.guardianPhone}</a> : '—'}</Td></tr>
            ))}</tbody></table></div>
        </Section>
      )}

      {data.compliance && (
        <Section title="Register compliance" hint="Registers marked on the day, by class teacher." action={exp('compliance')}>
          <div className="overflow-x-auto"><table className="min-w-full divide-y divide-line"><caption className="sr-only">Registers marked on time</caption>
            <thead><tr><Th>Class</Th><Th>Class teacher</Th><Th className="text-right">Marked</Th><Th className="text-right">On the day</Th><Th className="text-right">Missed</Th></tr></thead>
            <tbody className="divide-y divide-line">{data.compliance.map((c) => <tr key={c.classId}><Td className="font-semibold">{c.class}</Td><Td>{c.classTeacher ?? '—'}</Td><Td className="text-right tabular-nums">{c.marked} / {c.schoolDays}</Td><Td className="text-right tabular-nums">{pct(c.onTimePct)}</Td><Td className="text-right tabular-nums" title={c.missedDays.join(', ')}><span className={c.missed > 0 ? 'text-danger' : ''}>{c.missed}</span></Td></tr>)}</tbody></table></div>
        </Section>
      )}

      {data.groups && (
        <Section title="Attendance by group" action={exp('groups')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {([['Boys and girls', data.groups.gender.map((g) => [g.group, g.rate] as const)], ['Boarders and day scholars', data.groups.boarding.map((g) => [g.group, g.rate] as const)], ['Day of the week', data.groups.dayOfWeek.map((g) => [g.day, g.rate] as const)]] as const).map(([title, rows]) => (
              <div key={title}><h3 className="mb-1 text-sm font-semibold text-ink">{title}</h3><ul className="space-y-1 text-sm">{rows.map(([k, r]) => <li key={k} className="flex justify-between"><span>{k}</span><b>{pct(r)}</b></li>)}</ul></div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Syllabus coverage" hint="Planned topics covered, against what should be covered by this week." action={exp('coverage')}>
        <div className="grid gap-4 lg:grid-cols-2">
          {([['By department', data.coverage.byDepartment], ['By subject', data.coverage.bySubject]] as const).map(([title, rows]) => (
            <div key={title}><h3 className="mb-1 text-sm font-semibold text-ink">{title}</h3>
              <ul className="space-y-2">{rows.length === 0 && <li className="text-sm text-muted">No schemes yet.</li>}{rows.map((r) => (
                <li key={r.name}><div className="flex justify-between text-sm"><span>{r.name}</span><span><b>{pct(r.coverage)}</b> <span className="text-muted">of {r.due} due</span></span></div>
                  <div className="relative h-2 overflow-hidden rounded-full bg-canvas"><div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${r.coverage ?? 0}%` }} /></div></li>
              ))}</ul></div>
          ))}
        </div>
        {data.coverage.schemes.length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-primary">By teacher and class</summary>
            <ul className="mt-2 divide-y divide-line text-sm">{data.coverage.schemes.map((s) => <li key={s.assignmentId} className="flex justify-between py-1.5"><Link href={`/academics/schemes/${s.assignmentId}`} className="text-primary hover:underline">{s.subject} · {s.target} ({s.teacher})</Link><b className={s.coverage !== null && s.plannedByNow !== null && s.coverage < s.plannedByNow - 20 ? 'text-danger' : ''}>{pct(s.coverage)}</b></li>)}</ul></details>
        )}
      </Section>

      <Section title="Scheme compliance" hint={data.schemes.dueDate ? `Schemes were due on ${data.schemes.dueDate}.` : 'No due date has been set.'} action={exp('schemes')}>
        <div className="mb-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {([['Not started', data.schemes.counts.none], ['Draft', data.schemes.counts.draft], ['Submitted', data.schemes.counts.submitted], ['Approved', data.schemes.counts.approved], ['Returned', data.schemes.counts.returned], ['Late', data.schemes.counts.late]] as const).map(([k, n]) => (
            <div key={k} className={`rounded-xl p-2 ${k === 'Late' && n > 0 ? 'bg-danger-bg text-danger' : 'bg-canvas'}`}><p className="text-xl font-bold tabular-nums">{n}</p><p className="text-xs">{k}</p></div>
          ))}
        </div>
        <ul className="divide-y divide-line text-sm">{data.schemes.rows.filter((r) => r.late).map((r) => <li key={r.assignmentId} className="flex justify-between py-1.5"><Link href={`/academics/schemes/${r.assignmentId}`} className="text-primary hover:underline">{r.teacher}: {r.subject}, {r.target}</Link><Badge variant="danger" label="Late" /></li>)}</ul>
      </Section>

      <Section title="Teaching load" hint={`Periods a week against the maximum of ${data.load.maxPeriods}.`} action={exp('load')}>
        <ul className="space-y-2">{data.load.teachers.map((t) => (
          <li key={t.id}><div className="flex justify-between text-sm"><span>{t.name}{t.covers > 0 && <span className="text-muted"> · {t.covers} cover{t.covers === 1 ? '' : 's'}</span>}</span><b className={t.status === 'over' ? 'text-danger' : ''}>{t.periods}</b></div>
            <div className="h-2 overflow-hidden rounded-full bg-canvas"><div className={`h-full rounded-full ${t.status === 'over' ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${Math.min(100, t.pct)}%` }} /></div></li>
        ))}</ul>
      </Section>

      <Section title="Gaps" hint="Subjects without a teacher, and lessons not yet placed on the timetable." action={exp('gaps')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><h3 className="mb-1 text-sm font-semibold text-ink">No teacher ({data.gaps.subjects.length})</h3><ul className="space-y-1 text-sm">{data.gaps.subjects.length === 0 && <li className="text-success">None.</li>}{data.gaps.subjects.map((g) => <li key={g.classId + g.subjectId}><Link href="/academics/assignments" className="text-primary hover:underline">{g.subjectName} in {g.className}</Link></li>)}</ul></div>
          <div><h3 className="mb-1 text-sm font-semibold text-ink">Not fully placed ({data.gaps.unplaced.length})</h3><ul className="space-y-1 text-sm">{data.gaps.unplaced.length === 0 && <li className="text-success">None.</li>}{data.gaps.unplaced.map((u) => <li key={u.assignmentId}><Link href="/academics/timetable" className="text-primary hover:underline">{u.subject}, {u.target}: {u.placed} of {u.needed}</Link></li>)}</ul></div>
        </div>
      </Section>
    </div>
  );
}
