'use client';

import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/Toast';

interface BoundaryRow {
  minPercent: string;
  maxPercent: string;
  letterGrade: string;
}

const DEFAULT_BOUNDARIES: BoundaryRow[] = [
  { minPercent: '80', maxPercent: '100', letterGrade: 'A' },
  { minPercent: '70', maxPercent: '79',  letterGrade: 'B' },
  { minPercent: '60', maxPercent: '69',  letterGrade: 'C' },
  { minPercent: '50', maxPercent: '59',  letterGrade: 'D' },
  { minPercent: '40', maxPercent: '49',  letterGrade: 'E' },
  { minPercent: '0',  maxPercent: '39',  letterGrade: 'F' },
];

function validate(rows: BoundaryRow[]): string | null {
  for (const row of rows) {
    const min = Number(row.minPercent);
    const max = Number(row.maxPercent);
    if (row.minPercent === '' || row.maxPercent === '' || isNaN(min) || isNaN(max))
      return 'All percent fields must be numbers';
    if (min < 0 || max > 100) return 'Values must be between 0 and 100';
    if (min > max) return 'Min % must be ≤ Max %';
    if (!row.letterGrade.trim()) return 'Letter grade cannot be empty';
  }
  const sorted = [...rows]
    .map((r) => ({ min: Number(r.minPercent), max: Number(r.maxPercent) }))
    .sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.min <= prev.max) return 'Ranges must not overlap';
    if (curr.min > prev.max + 1) return `Gap between ${prev.max}% and ${curr.min}%`;
  }
  return null;
}

export function GradeBoundariesManager() {
  const [rows, setRows] = useState<BoundaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/results/grade-boundaries')
      .then((r) => r.json())
      .then((body) => {
        if (body.success && body.data.boundaries.length > 0) {
          setRows(
            body.data.boundaries.map((b: { minPercent: number; maxPercent: number; letterGrade: string }) => ({
              minPercent:  String(b.minPercent),
              maxPercent:  String(b.maxPercent),
              letterGrade: b.letterGrade,
            })),
          );
        } else {
          setRows(DEFAULT_BOUNDARIES);
        }
      })
      .catch(() => toast.error('Failed to load grade boundaries'))
      .finally(() => setLoading(false));
  }, []);

  function updateRow(idx: number, field: keyof BoundaryRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
    setError(null);
  }

  function addRow() {
    setRows((prev) => [...prev, { minPercent: '', maxPercent: '', letterGrade: '' }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
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
          boundaries: rows.map((r) => ({
            minPercent:  Number(r.minPercent),
            maxPercent:  Number(r.maxPercent),
            letterGrade: r.letterGrade.trim(),
          })),
        }),
      });
      const body = await res.json();
      if (body.success) {
        toast.success('Grade boundaries saved');
      } else {
        setError(body.message ?? 'Failed to save');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="py-4 text-center text-sm text-[#78716c]">Loading grade boundaries…</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#292524]">Grade Boundaries</h2>
          <p className="text-sm text-[#78716c]">
            Define the percentage ranges that map to letter grades. Must cover 0–100 with no gaps or overlaps.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-[#e7e5e4] bg-white px-3 py-2 text-sm font-medium text-[#292524] transition hover:bg-[#f5f5f4]"
          >
            + Add Row
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[#065f46] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#047857] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
        <table className="w-full text-left text-sm text-[#292524]">
          <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
            <tr>
              {['Min %', 'Max %', 'Letter Grade', ''].map((h, i) => (
                <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7e5e4] bg-white">
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={row.minPercent}
                    onChange={(e) => updateRow(idx, 'minPercent', e.target.value)}
                    className="w-20 rounded-md border border-[#e7e5e4] px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={row.maxPercent}
                    onChange={(e) => updateRow(idx, 'maxPercent', e.target.value)}
                    className="w-20 rounded-md border border-[#e7e5e4] px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    maxLength={5}
                    value={row.letterGrade}
                    onChange={(e) => updateRow(idx, 'letterGrade', e.target.value)}
                    className="w-20 rounded-md border border-[#e7e5e4] px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-xs text-red-500 hover:text-red-700"
                    aria-label="Remove row"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-[#78716c]">
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
