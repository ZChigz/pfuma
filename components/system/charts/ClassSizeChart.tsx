import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { loadChartData, type ClassSize } from '@/lib/system/charts';
import type { SummaryTerm } from '@/lib/system/summary';
import { BOYS, CAPACITY_INK, ChartPanel, EmptyPanel, LegendItem } from './chart-parts';

/** Pure drawing. `classes` must already be sorted, biggest first. */
export function ClassSizeBars({ classes }: { classes: ClassSize[] }) {
  const scale = Math.max(1, ...classes.map((c) => Math.max(c.count, c.capacity)));
  return (
    <>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
        <LegendItem color={BOYS} label="Students" />
        <LegendItem color={CAPACITY_INK} label="Capacity" line />
      </ul>
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
        {classes.map((c) => {
          const over = c.count - c.capacity;
          return (
            <li
              key={c.id}
              tabIndex={0}
              title={`${c.name}: ${c.count} students, capacity ${c.capacity}`}
              aria-label={`${c.name}: ${c.count} students, capacity ${c.capacity}${over > 0 ? `, ${over} over` : ''}`}
              className="flex items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="w-24 flex-shrink-0 truncate text-sm text-ink">{c.name}</span>
              <div className="relative h-5 min-w-0 flex-1">
                <div className="h-5 rounded-r-[4px]" style={{ width: `${(c.count / scale) * 100}%`, background: BOYS }} />
                <span aria-hidden="true" className="absolute -bottom-0.5 -top-0.5 w-[2px]" style={{ left: `calc(${(c.capacity / scale) * 100}% - 1px)`, background: CAPACITY_INK }} />
              </div>
              <span className="w-24 flex-shrink-0 text-right text-sm tabular-nums text-ink">
                {c.count}
                {over > 0 && <span className="ml-1 text-xs font-medium text-warn">▲ {over} over</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="min-h-[44px] cursor-pointer content-center text-xs font-medium text-primary">View as table</summary>
        <table className="mt-1 w-full text-left text-xs text-ink">
          <thead className="text-subtle">
            <tr><th className="py-1 font-medium">Class</th><th className="py-1 font-medium">Students</th><th className="py-1 font-medium">Capacity</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {classes.map((c) => <tr key={c.id}><td className="py-1">{c.name}</td><td>{c.count}</td><td>{c.capacity}</td></tr>)}
          </tbody>
        </table>
      </details>
    </>
  );
}

export async function ClassSizeChart({ user, term }: { user: AccessUser; term: SummaryTerm | null }) {
  if (!can(user, 'academics.classes.view')) return null;
  const title = 'Students per class';
  if (!term) {
    return <ChartPanel title={title}><EmptyPanel message="No term yet, so there is nothing to count." action={{ label: 'Set up the academic calendar', href: '/admin/academic' }} /></ChartPanel>;
  }
  const data = await loadChartData(getScopedDb(user.schoolId, user.id), user.schoolId, term);
  if (data.classes.length === 0) {
    return <ChartPanel title={title}><EmptyPanel message="No classes have been created yet." action={{ label: 'Create classes', href: '/admin/classes' }} /></ChartPanel>;
  }
  if (data.students === 0) {
    return (
      <ChartPanel title={title}>
        <EmptyPanel message="No students are enrolled in this term yet." action={can(user, 'students.profiles.import') ? { label: 'Import students', href: '/students/import' } : undefined} />
      </ChartPanel>
    );
  }
  return <ChartPanel title={title} subtitle="Biggest first. The line marks each class's capacity."><ClassSizeBars classes={data.classes} /></ChartPanel>;
}
