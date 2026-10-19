'use client';

import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/Toast';
import { boundariesFor, validateBoundaries } from '@/lib/results';

interface BoundaryRow {
  minPercent: string;
  maxPercent: string;
  letterGrade: string;
}

interface StoredBoundary {
  minPercent: number;
  maxPercent: number;
  letterGrade: string;
  levelId: string | null;
  termId: string | null;
}

interface Props {
  levels: { id: string; name: string }[];
  terms: { id: string; name: string }[];
}

const DEFAULT_BOUNDARIES: BoundaryRow[] = [
  { minPercent: '80', maxPercent: '100', letterGrade: 'A' },
  { minPercent: '70', maxPercent: '79',  letterGrade: 'B' },
  { minPercent: '60', maxPercent: '69',  letterGrade: 'C' },
  { minPercent: '50', maxPercent: '59',  letterGrade: 'D' },
  { minPercent: '40', maxPercent: '49',  letterGrade: 'E' },
  { minPercent: '0',  maxPercent: '39',  letterGrade: 'F' },
];

const toRows = (set: StoredBoundary[]): BoundaryRow[] =>
  [...set]
    .sort((a, b) => b.minPercent - a.minPercent)
    .map((b) => ({ minPercent: String(b.minPercent), maxPercent: String(b.maxPercent), letterGrade: b.letterGrade }));

function validate(rows: BoundaryRow[]): string | null {
  for (const row of rows) {
    if (row.minPercent === '' || row.maxPercent === '' || isNaN(Number(row.minPercent)) || isNaN(Number(row.maxPercent))) {
      return 'All percent fields must be numbers';
    }
  }
  return validateBoundaries(
    rows.map((r) => ({ minPercent: Number(r.minPercent), maxPercent: Number(r.maxPercent), letterGrade: r.letterGrade.trim() })),
  );
}

// One set of boundaries per (level, term) choice; "All levels" / "All terms" are the
// general sets. A class uses the most specific set that exists for its level and term.
export function GradeBoundariesManager({ levels, terms }: Props) {
  const [all, setAll] = useState<StoredBoundary[]>([]);
  const [levelId, setLevelId] = useState('');
  const [termId, setTermId] = useState('');
  const [rows, setRows] = useState<BoundaryRow[]>([]);
  const [hasOwnSet, setHasOwnSet] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGeneral = levelId === '' && termId === '';
  const own = (set: StoredBoundary[], l: string, t: string) =>
    set.filter((b) => (b.levelId ?? '') === l && (b.termId ?? '') === t);

  function show(set: StoredBoundary[], l: string, t: string) {
    const mine = own(set, l, t);
    setHasOwnSet(mine.length > 0);
    // Without a set of its own the scope shows what it currently inherits.
    const inherited = mine.length > 0 ? mine : boundariesFor(set, l || null, t || null);
    setRows(inherited.length > 0 ? toRows(inherited) : l === '' && t === '' ? DEFAULT_BOUNDARIES : []);
    setError(null);
  }

  useEffect(() => {
    fetch('/api/results/grade-boundaries')
      .then((r) => r.json())
      .then((body) => {
        if (body.success) {
          setAll(body.data.boundaries);
          show(body.data.boundaries, '', '');
        }
      })
      .catch(() => toast.error('Failed to load grade boundaries'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseScope(l: string, t: string) {
    setLevelId(l);
    setTermId(t);
    show(all, l, t);
  }

  function updateRow(idx: number, field: keyof BoundaryRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    setError(null);
  }

  async function handleSave() {
    const err = validate(rows);
    if (err) { setError(err); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/results/grade-boundaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levelId: levelId || null,
          termId: termId || null,
          boundaries: rows.map((r) => ({
            minPercent:  Number(r.minPercent),
            maxPercent:  Number(r.maxPercent),
            letterGrade: r.letterGrade.trim(),
          })),
        }),
      });
      const body = await res.json();
      if (body.success) {
        toast.success('Grade boundaries saved. Published grades are not changed.');
        setAll(body.data.boundaries);
        setHasOwnSet(true);
      } else {
        setError(body.message ?? 'Failed to save');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove this set? These classes will use the more general boundaries again.')) return;
    const q = new URLSearchParams();
    if (levelId) q.set('levelId', levelId);
    if (termId) q.set('termId', termId);
    const res = await fetch(`/api/results/grade-boundaries?${q}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.message ?? 'Could not remove'); return; }
    const next = all.filter((b) => !((b.levelId ?? '') === levelId && (b.termId ?? '') === termId));
    setAll(next);
    show(next, levelId, termId);
    toast.success('Removed');
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted">Loading grade boundaries…</p>;
  }

  const select = 'min-h-[40px] rounded-xl border border-line bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Grade Boundaries</h2>
          <p className="text-sm text-muted">
            Percentage ranges that map to letter grades. Each set must run from 0 to 100 with no gaps or overlaps. A class uses the
            most specific set for its level and term, so O Level and A Level can differ. Each mark keeps the grade it was given, so
            changing boundaries later never alters published grades.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { minPercent: '', maxPercent: '', letterGrade: '' }])}
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-rowhover"
          >
            + Add Row
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || rows.length === 0}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-hover disabled:opacity-60"
          >
            {saving ? 'Saving…' : hasOwnSet ? 'Save' : 'Save as its own set'}
          </button>
          {!isGeneral && hasOwnSet && (
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-danger transition hover:bg-rowhover"
            >
              Remove set
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Level
          <select className={select} value={levelId} onChange={(e) => chooseScope(e.target.value, termId)}>
            <option value="">All levels</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Term
          <select className={select} value={termId} onChange={(e) => chooseScope(levelId, e.target.value)}>
            <option value="">All terms</option>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>

      {!hasOwnSet && !isGeneral && (
        <p className="rounded-xl bg-warn-bg px-4 py-2 text-sm text-warn">
          This level and term use the more general boundaries shown below. Edit them and save to give this choice its own set.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-transparent bg-danger-bg px-4 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-white">
            <tr>
              {['Min %', 'Max %', 'Letter Grade', ''].map((h, i) => (
                <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td className="px-4 py-2">
                  <input
                    type="number" min={0} max={100} step={0.01}
                    value={row.minPercent}
                    onChange={(e) => updateRow(idx, 'minPercent', e.target.value)}
                    className="w-24 rounded-xl border border-line px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number" min={0} max={100} step={0.01}
                    value={row.maxPercent}
                    onChange={(e) => updateRow(idx, 'maxPercent', e.target.value)}
                    className="w-24 rounded-xl border border-line px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text" maxLength={5}
                    value={row.letterGrade}
                    onChange={(e) => updateRow(idx, 'letterGrade', e.target.value)}
                    className="w-20 rounded-xl border border-line px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => { setRows((prev) => prev.filter((_, i) => i !== idx)); setError(null); }}
                    className="text-xs text-danger hover:text-danger"
                    aria-label="Remove row"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No boundaries defined. Click &ldquo;+ Add Row&rdquo; to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
