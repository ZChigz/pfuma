import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadChartData, type FormEnrolment } from '@/lib/system/charts';
import type { SummaryTerm } from '@/lib/system/summary';
import { BOYS, GIRLS, NEUTRAL, ChartPanel, EmptyPanel, LegendItem } from './chart-parts';

/** Pure drawing, so it can be tested without a database. */
export function EnrolmentBars({ forms }: { forms: FormEnrolment[] }) {
  const max = Math.max(1, ...forms.map((f) => f.total));
  const unrecorded = forms.some((f) => f.unrecorded > 0);
  return (
    <>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
        <LegendItem color={BOYS} label="Boys" />
        <LegendItem color={GIRLS} label="Girls" />
        {unrecorded && <LegendItem color={NEUTRAL} label="Not recorded" />}
      </ul>
      <ul className="flex flex-col gap-2">
        {forms.map((f) => (
          <li
            key={f.levelId}
            tabIndex={0}
            title={`${f.name}: ${f.boys} boys, ${f.girls} girls${f.unrecorded ? `, ${f.unrecorded} not recorded` : ''}`}
            aria-label={`${f.name}: ${f.total} students, ${f.boys} boys and ${f.girls} girls`}
            className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="w-16 flex-shrink-0 text-sm text-ink">{f.name}</span>
            <div className="min-w-0 flex-1">
              <div className="flex h-5 gap-[2px]" style={{ width: `${(f.total / max) * 100}%` }}>
                {[{ n: f.boys, c: BOYS }, { n: f.girls, c: GIRLS }, { n: f.unrecorded, c: NEUTRAL }]
                  .filter((s) => s.n > 0)
                  .map((s, i, all) => (
                    <div key={s.c} style={{ flex: s.n, background: s.c }} className={i === all.length - 1 ? 'rounded-r-[4px]' : ''} />
                  ))}
              </div>
            </div>
            <span className="w-10 flex-shrink-0 text-right text-sm font-medium tabular-nums text-ink">{f.total}</span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="min-h-[44px] cursor-pointer content-center text-xs font-medium text-primary">View as table</summary>
        <table className="mt-1 w-full text-left text-xs text-ink">
          <thead className="text-subtle">
            <tr><th className="py-1 font-medium">Form</th><th className="py-1 font-medium">Boys</th><th className="py-1 font-medium">Girls</th><th className="py-1 font-medium">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {forms.map((f) => <tr key={f.levelId}><td className="py-1">{f.name}</td><td>{f.boys}</td><td>{f.girls}</td><td>{f.total}</td></tr>)}
          </tbody>
        </table>
      </details>
    </>
  );
}

export async function EnrolmentChart({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'students.list.view')) return null;
  const title = 'Enrolment by form';
  if (!term) {
    return <ChartPanel title={title}><EmptyPanel message="No term yet, so there is nothing to count." action={{ label: 'Set up the academic calendar', href: '/admin/academic' }} /></ChartPanel>;
  }
  const data = await loadChartData(getScopedDb(user.schoolId, user.id), user.schoolId, term);
  if (data.forms.length === 0) {
    return <ChartPanel title={title}><EmptyPanel message="No classes yet, so no form has students." action={{ label: 'Create classes', href: '/admin/classes' }} /></ChartPanel>;
  }
  if (data.students === 0) {
    return (
      <ChartPanel title={title}>
        <EmptyPanel message="No students are enrolled in this term yet." action={can(user, 'students.import') ? { label: 'Import students', href: '/admin/students' } : undefined} />
      </ChartPanel>
    );
  }
  return <ChartPanel title={title} subtitle="Students per form, boys and girls"><EnrolmentBars forms={data.forms} /></ChartPanel>;
}
