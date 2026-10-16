'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { validateBoundaries } from '@/lib/results';
import { CATEGORY_LABEL, DEFAULT_SCALES, type ScaleRow, type ScaleSource } from '@/lib/system/grading-scales';

export interface ScaleData { category: 'O_LEVEL' | 'A_LEVEL'; source: ScaleSource; rows: ScaleRow[] }

type EditRow = { letterGrade: string; minPercent: string; maxPercent: string; points: string; remark: string };
const toEdit = (rows: ScaleRow[]): EditRow[] =>
  rows.map((r) => ({ letterGrade: r.letterGrade, minPercent: String(r.minPercent), maxPercent: String(r.maxPercent), points: r.points === null ? '' : String(r.points), remark: r.remark ?? '' }));

const SOURCE_NOTE: Record<ScaleSource, string> = {
  saved: 'This is the scale your school chose.',
  'school-wide': 'Showing your older school-wide scale, which is what marks are graded with now. Save it to make it the O Level / A Level scale.',
  default: 'Showing the standard starting scale. Marks are not graded with it until you confirm it. Change anything you need, then save.',
};

function ScaleEditor({ data, canUpdate }: { data: ScaleData; canUpdate: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<EditRow[]>(() => toEdit(data.rows));
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(toEdit(data.rows)), [data.rows]);

  const nums = rows.map((r) => ({ ...r, min: r.minPercent === '' ? NaN : Number(r.minPercent), max: r.maxPercent === '' ? NaN : Number(r.maxPercent) }));
  // The same checks the server makes, so the person sees the problem as they type.
  const problem =
    nums.some((r) => Number.isNaN(r.min) || Number.isNaN(r.max))
      ? 'Fill in the lowest and highest % of every grade'
      : data.category === 'A_LEVEL' && rows.some((r) => r.points === '')
        ? 'Enter points for every A Level grade'
        : rows.length < 2
          ? 'A scale needs at least two grades'
          : validateBoundaries(nums.map((r) => ({ letterGrade: r.letterGrade, minPercent: r.min, maxPercent: r.max })));
  const dirty = JSON.stringify(rows) !== JSON.stringify(toEdit(data.rows));
  const needsConfirm = data.source !== 'saved';

  const set = (i: number, change: Partial<EditRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...change } : r)));

  async function save() {
    setBusy(true);
    try {
      const body = { rows: rows.map((r) => ({ letterGrade: r.letterGrade.trim(), minPercent: Number(r.minPercent), maxPercent: Number(r.maxPercent), points: r.points === '' ? null : Number(r.points), remark: r.remark })) };
      const res = await fetch(`/api/system/grading/${data.category}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { toast.error(json.errors ? Object.values(json.errors as Record<string, string[]>).flat()[0] : json.message ?? 'Could not save'); return; }
      toast.success(`${CATEGORY_LABEL[data.category]} scale saved`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const input = 'min-h-[44px] w-full rounded-lg border border-line bg-white px-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-canvas';

  return (
    <Card title={CATEGORY_LABEL[data.category]} action={<Badge variant={data.source === 'saved' ? 'success' : 'warning'} label={data.source === 'saved' ? 'Chosen' : data.source === 'default' ? 'Not confirmed' : 'Older scale'} />}>
      <p className="mb-3 text-sm text-muted">{SOURCE_NOTE[data.source]}</p>
      <div className="hidden grid-cols-[4rem,1fr,1fr,5rem,2fr,2.75rem] gap-2 px-1 pb-1 text-xs font-medium text-subtle sm:grid">
        <span>Grade</span><span>Lowest %</span><span>Highest %</span><span>Points</span><span>Remark</span><span />
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-2 gap-2 rounded-xl bg-canvas p-2 sm:grid-cols-[4rem,1fr,1fr,5rem,2fr,2.75rem] sm:bg-transparent sm:p-0">
            <label className="sm:contents"><span className="mb-0.5 block text-xs text-subtle sm:sr-only">Grade</span>
              <input aria-label={`Grade ${i + 1}`} className={input} maxLength={3} disabled={!canUpdate} value={r.letterGrade} onChange={(e) => set(i, { letterGrade: e.target.value })} /></label>
            <label className="sm:contents"><span className="mb-0.5 block text-xs text-subtle sm:sr-only">Lowest %</span>
              <input aria-label={`Lowest % of grade ${r.letterGrade || i + 1}`} className={input} type="number" inputMode="decimal" min={0} max={100} disabled={!canUpdate} value={r.minPercent} onChange={(e) => set(i, { minPercent: e.target.value })} /></label>
            <label className="sm:contents"><span className="mb-0.5 block text-xs text-subtle sm:sr-only">Highest %</span>
              <input aria-label={`Highest % of grade ${r.letterGrade || i + 1}`} className={input} type="number" inputMode="decimal" min={0} max={100} disabled={!canUpdate} value={r.maxPercent} onChange={(e) => set(i, { maxPercent: e.target.value })} /></label>
            <label className="sm:contents"><span className="mb-0.5 block text-xs text-subtle sm:sr-only">Points</span>
              <input aria-label={`Points of grade ${r.letterGrade || i + 1}`} className={input} type="number" inputMode="numeric" min={0} disabled={!canUpdate} value={r.points} onChange={(e) => set(i, { points: e.target.value })} /></label>
            <label className="col-span-2 sm:contents"><span className="mb-0.5 block text-xs text-subtle sm:sr-only">Remark</span>
              <input aria-label={`Remark of grade ${r.letterGrade || i + 1}`} className={input} maxLength={60} disabled={!canUpdate} value={r.remark} onChange={(e) => set(i, { remark: e.target.value })} /></label>
            {canUpdate && (
              <button type="button" aria-label={`Remove grade ${r.letterGrade || i + 1}`} onClick={() => setRows((all) => all.filter((_, j) => j !== i))} className="col-span-2 min-h-[44px] rounded-lg text-sm font-medium text-danger hover:bg-danger-bg sm:col-span-1">
                <span className="sm:hidden">Remove </span>×
              </button>
            )}
          </li>
        ))}
      </ul>

      {problem && dirty && <p role="alert" className="mt-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{problem}</p>}
      {!problem && <p className="mt-3 text-xs text-success">The ranges cover 0 to 100 with no gaps or overlaps.</p>}

      {canUpdate && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setRows(toEdit(DEFAULT_SCALES[data.category]))} disabled={busy}>Use standard scale</Button>
          <Button variant="secondary" onClick={() => setRows((all) => [...all, { letterGrade: '', minPercent: '', maxPercent: '', points: '', remark: '' }])} disabled={busy || rows.length >= 15}>Add grade</Button>
          <Button onClick={save} loading={busy} disabled={!!problem || (!dirty && !needsConfirm)}>{needsConfirm ? 'Confirm and save scale' : 'Save scale'}</Button>
        </div>
      )}
    </Card>
  );
}

export function GradingTab({ scales, canUpdate }: { scales: ScaleData[]; canUpdate: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-muted">One scale for O Level and one for A Level. Each grade has the lowest and highest percentage, points and a remark. Confirm or change them before the first results; marks already graded keep the grade they were given.</p>
      {scales.map((s) => <ScaleEditor key={s.category} data={s} canUpdate={canUpdate} />)}
    </div>
  );
}
