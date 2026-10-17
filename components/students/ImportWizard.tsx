'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { parseCsv } from '@/lib/students/csv';
import { applyMapping, autoMap, IMPORT_FIELDS, type ImportFieldKey, type ImportRow } from '@/lib/students/import-map';
import { api, problem, Section, useBusy } from '@/components/students/shared';

const STEPS = ['Upload', 'Match columns', 'Review', 'Done'];
const MAX_BYTES = 2 * 1024 * 1024;

interface Checked { rowNumber: number; status: 'OK' | 'WARNING' | 'ERROR'; messages: string[]; name: string }
interface Summary { total: number; ok: number; warnings: number; errors: number }
interface Result { imported: number; skipped: number; guardiansCreated: number; guardiansShared: number; classesCreated: string[]; reportCsv: string; summary: Summary }

const download = (name: string, text: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<ImportFieldKey, number | null> | null>(null);
  const [rows, setRows] = useState<{ rowNumber: number; values: ImportRow }[]>([]);
  const [checked, setChecked] = useState<Checked[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reportCsv, setReportCsv] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  const headings = grid[0] ?? [];
  const auto = useMemo(() => (grid.length ? autoMap(headings) : null), [grid, headings]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > MAX_BYTES) { setError('The file is too big (at most 2 MB). Split it into smaller files.'); return; }
    if (!/\.(csv|txt)$/i.test(file.name)) { setError('Choose a CSV file. In Excel use Save As, CSV.'); return; }
    const g = parseCsv(await file.text());
    if (g.length < 2) { setError('The file has no students in it.'); return; }
    if (g.length - 1 > 1500) { setError(`The file has ${g.length - 1} students. Split it into files of 1500 or fewer.`); return; }
    setFileName(file.name); setGrid(g); setMapping(autoMap(g[0]!).mapping); setStep(1);
  }

  async function check(next = rows) {
    const r = await run(() => api('/api/students/import/check', 'POST', { rows: next }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    setChecked(r.body.data.rows); setSummary(r.body.data.summary); setReportCsv(r.body.data.reportCsv); setError(''); setStep(2);
  }

  function toReview() {
    if (!mapping) return;
    const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === null);
    const classOk = mapping.class_name !== null;
    const still = missing.filter((f) => !((f.key === 'form' || f.key === 'stream') && classOk));
    if (still.length) { setError(`Choose a column for: ${still.map((f) => f.label).join(', ')}.`); return; }
    const mapped = applyMapping(grid, mapping);
    setRows(mapped); setError(''); void check(mapped);
  }

  const edit = (rowNumber: number, key: ImportFieldKey, v: string) => setRows((l) => l.map((r) => (r.rowNumber === rowNumber ? { ...r, values: { ...r.values, [key]: v } } : r)));

  async function confirm() {
    const r = await run(() => api('/api/students/import', 'POST', { rows }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    setResult(r.body.data); setStep(3); toast.success(`${r.body.data.imported} students imported`);
  }

  const shown = checked.filter((c) => (filter === 'ALL' ? c.status !== 'OK' : c.status === filter)).slice(0, 100);
  const importable = (summary?.ok ?? 0) + (summary?.warnings ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-1" aria-label="Steps">
        {STEPS.map((l, i) => <li key={l} aria-current={i === step ? 'step' : undefined} className={cn('flex-1 rounded-xl px-2 py-2.5 text-center text-xs font-semibold sm:text-sm', i === step ? 'bg-primary text-white' : i < step ? 'bg-tint text-primary' : 'bg-white text-muted')}>{i + 1}. {l}</li>)}
      </ol>
      {error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}

      {step === 0 && (
        <Section title="Upload a CSV file">
          <p className="text-sm text-muted">One student per row. The columns are first_name, surname, gender, date_of_birth, birth_certificate_no, form, stream, boarding, admission_date, guardian_name, guardian_relationship, guardian_phone, guardian_phone_2 and address.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href="/api/students/import" className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Download the template</a>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">
              Choose a file<input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">Nothing is saved until you confirm on the last step. Guardians with the same phone number become one guardian record.</p>
        </Section>
      )}

      {step === 1 && mapping && auto && (
        <Section title="Match the columns" action={<span className="text-xs text-muted">{fileName}: {grid.length - 1} students</span>}>
          <p className="mb-3 text-sm text-muted">Headings that look the same are matched for you. Check them, and choose a column for any that are missing.</p>
          <ul className="flex flex-col gap-2">
            {IMPORT_FIELDS.map((f) => (
              <li key={f.key} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[1fr_1fr]">
                <label htmlFor={`map-${f.key}`} className="text-sm font-medium text-ink">{f.label}{f.required && <span className="text-danger"> *</span>}</label>
                <select id={`map-${f.key}`} value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}
                  className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">{f.required ? 'Choose a column' : 'Not in my file'}</option>
                  {headings.map((h, i) => <option key={i} value={i}>{h || `(column ${i + 1})`}</option>)}
                </select>
              </li>
            ))}
          </ul>
          {auto.unmatched.length > 0 && <p className="mt-3 text-xs text-muted">Not used: {auto.unmatched.map((u) => u.heading).join(', ')}.</p>}
          <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button onClick={toReview} loading={busy}>Check the rows</Button></div>
        </Section>
      )}

      {step === 2 && summary && (
        <Section title="Review">
          <div className="grid grid-cols-3 gap-2 text-center">
            <button type="button" onClick={() => setFilter('ALL')} className="rounded-xl bg-success-bg p-3"><span className="block text-2xl font-bold text-success">{summary.ok}</span><span className="text-xs text-muted">OK</span></button>
            <button type="button" onClick={() => setFilter('WARNING')} className="rounded-xl bg-warn-bg p-3"><span className="block text-2xl font-bold text-warn">{summary.warnings}</span><span className="text-xs text-muted">Warnings (imported)</span></button>
            <button type="button" onClick={() => setFilter('ERROR')} className="rounded-xl bg-danger-bg p-3"><span className="block text-2xl font-bold text-danger">{summary.errors}</span><span className="text-xs text-muted">Errors (skipped)</span></button>
          </div>
          <p className="mt-3 text-sm text-muted">Showing {filter === 'ALL' ? 'rows to look at' : filter === 'ERROR' ? 'errors' : 'warnings'}. Fix a cell and check again, or leave an error row out: it is skipped and listed in the report.</p>
          {shown.length === 0 ? <p className="mt-3 text-sm text-ink">Nothing to look at here.</p> : (
            <ul className="mt-3 flex flex-col gap-3">
              {shown.map((c) => {
                const row = rows.find((r) => r.rowNumber === c.rowNumber);
                return (
                  <li key={c.rowNumber} className="rounded-xl border border-line p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">Row {c.rowNumber}: {c.name} <Badge variant={c.status === 'ERROR' ? 'danger' : 'warning'} label={c.status === 'ERROR' ? 'Error' : 'Warning'} /></p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-ink">{c.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
                    {row && (
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(['first_name', 'surname', 'gender', 'date_of_birth', 'form', 'stream', 'guardian_name', 'guardian_phone'] as ImportFieldKey[]).map((k) => (
                          <label key={k} className="flex flex-col gap-0.5 text-xs text-muted">{IMPORT_FIELDS.find((f) => f.key === k)!.label}
                            <input value={row.values[k] ?? ''} onChange={(e) => edit(c.rowNumber, k, e.target.value)} className="min-h-[40px] rounded-lg border border-line px-2 text-sm text-ink" />
                          </label>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button variant="secondary" onClick={() => check()} loading={busy}>Check again</Button>
            {summary.errors > 0 && <Button variant="secondary" onClick={() => download('skipped-rows.csv', reportCsv)}>Download the skipped rows</Button>}
            <Button onClick={confirm} loading={busy} disabled={importable === 0}>Import {importable} student{importable === 1 ? '' : 's'}</Button>
          </div>
        </Section>
      )}

      {step === 3 && result && (
        <Section title="Done">
          <p className="text-lg font-semibold text-ink">{result.imported} students imported.</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink">
            <li>{result.guardiansCreated} guardian{result.guardiansCreated === 1 ? '' : 's'} added{result.guardiansShared > 0 ? `; ${result.guardiansShared} student${result.guardiansShared === 1 ? '' : 's'} share a guardian already in the file` : ''}.</li>
            {result.classesCreated.length > 0 && <li>New classes: {result.classesCreated.join(', ')}.</li>}
            {result.skipped > 0 && <li>{result.skipped} row{result.skipped === 1 ? ' was' : 's were'} skipped.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            {result.skipped > 0 && <Button variant="secondary" onClick={() => download('skipped-rows.csv', result.reportCsv)}>Download the report of skipped rows</Button>}
            <Link href="/students" className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">See the students</Link>
          </div>
        </Section>
      )}
    </div>
  );
}
