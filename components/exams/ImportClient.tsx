'use client';

// Import marks: download a pre-filled template (CSV or Excel) for one assessment, fill it in offline, upload it, review the rows
// (errors are listed with the line number and the reason), and confirm. Nothing is saved until the teacher confirms.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Notice, Section, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import { parseCsv } from '@/lib/students/csv';
import { rowsFromTable, type ImportReview } from '@/lib/exams/import-table';

interface Target { key: string; assessmentId: string; stageId: string | null; label: string; max: number }

export function ImportClient({ assignmentId, targets, canEdit, needsReason }: { assignmentId: string; targets: Target[]; canEdit: boolean; needsReason: boolean }) {
  const router = useRouter();
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? '');
  const [review, setReview] = useState<ImportReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const target = targets.find((t) => t.key === targetKey);
  const q = target ? `assessmentId=${target.assessmentId}${target.stageId ? `&stageId=${target.stageId}` : ''}` : '';

  async function upload(file: File) {
    if (!target) return;
    setBusy(true);
    setReview(null);
    let r;
    if (/\.csv$|\.txt$/i.test(file.name)) {
      let rows;
      try { rows = rowsFromTable(parseCsv(await file.text())); } catch (e) { setBusy(false); return toast.error(e instanceof Error ? e.message : 'That file could not be read'); }
      r = await api('/api/exams/marks/import/preview', 'POST', { assignmentId, assessmentId: target.assessmentId, stageId: target.stageId, rows });
    } else {
      const form = new FormData();
      form.set('file', file); form.set('assignmentId', assignmentId); form.set('assessmentId', target.assessmentId);
      if (target.stageId) form.set('stageId', target.stageId);
      try {
        const res = await fetch('/api/exams/marks/import/preview', { method: 'POST', body: form });
        const body = await res.json().catch(() => ({}));
        r = { ok: res.ok, status: res.status, body };
      } catch { r = { ok: false, status: 0, body: { message: 'There is no connection. Check your data and try again.' } }; }
    }
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setReview(r.body.data as ImportReview);
  }

  async function confirm() {
    if (!review || !target) return;
    const cells = review.rows.filter((x) => x.cell).map((x) => x.cell!);
    if (cells.length === 0) return;
    if (needsReason && reason.trim().length < 3) return toast.error('Give a reason for changing marks on a sheet that was submitted before.');
    setBusy(true);
    const r = await api('/api/exams/marks', 'PUT', { assignmentId, cells, source: 'import', reason: reason.trim() || null });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { saved: number; outcomes: { status: string; message?: string }[] };
    const refused = d.outcomes.filter((o) => o.status === 'rejected').length;
    toast.success(`${d.saved} mark${d.saved === 1 ? '' : 's'} imported${refused ? `, ${refused} refused` : ''}`);
    router.push(`/exams/marks/${assignmentId}`);
    router.refresh();
  }

  if (targets.length === 0) return <Notice tone="warn">There are no assessments to import marks into yet.</Notice>;

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <Notice tone="warn">This mark sheet is locked, so marks cannot be imported.</Notice>}
      <Section title="1. Download the template" hint="It lists every student of the class with the mark they have now.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5"><label htmlFor="imp-target" className={labelClass}>Assessment</label>
            <select id="imp-target" className={fieldClass} value={targetKey} onChange={(e) => { setTargetKey(e.target.value); setReview(null); }}>{targets.map((t) => <option key={t.key} value={t.key}>{t.label} (out of {t.max})</option>)}</select></div>
          <a className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/marks/${assignmentId}/template?${q}&format=xlsx`}>Excel template</a>
          <a className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint" href={`/api/exams/marks/${assignmentId}/template?${q}&format=csv`}>CSV template</a>
        </div>
      </Section>

      <Section title="2. Upload the filled-in file" hint="Type a mark, or AB, EX or NS. An empty mark leaves the student as they are.">
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx" disabled={!canEdit || busy} aria-label="File to upload"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }}
          className="block w-full text-sm text-ink file:mr-3 file:min-h-[44px] file:rounded-full file:border-0 file:bg-primary file:px-5 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-hover" />
      </Section>

      {review && (
        <Section title="3. Check and confirm" hint={`${review.title}, out of ${review.max}`}>
          <p className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge variant="success" label={`${review.counts.ok} to import`} />
            <Badge variant="neutral" label={`${review.counts.unchanged} unchanged`} />
            {review.counts.errors > 0 && <Badge variant="danger" label={`${review.counts.errors} with errors`} />}
          </p>
          <div className="max-h-96 overflow-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-left">
              <thead className="sticky top-0 bg-white"><tr><Th>Line</Th><Th>Admission no.</Th><Th>Name</Th><Th>Now</Th><Th>File</Th><Th>Result</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {review.rows.map((r) => (
                  <tr key={r.line} className={r.status === 'ERROR' ? 'bg-danger-bg' : undefined}>
                    <Td>{r.line}</Td><Td>{r.admissionNumber}</Td><Td>{r.name}</Td><Td>{r.before || '-'}</Td><Td className="font-semibold">{r.raw || '-'}</Td>
                    <Td className={r.status === 'ERROR' ? 'text-danger' : r.status === 'OK' ? 'text-success' : 'text-muted'}>{r.status === 'OK' ? 'Will import' : r.message}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {review.notInFile.length > 0 && <p className="mt-3 text-sm text-muted">{review.notInFile.length} student{review.notInFile.length === 1 ? ' is' : 's are'} not in the file and keep their marks: {review.notInFile.slice(0, 5).map((s) => s.name).join('; ')}{review.notInFile.length > 5 ? ' ...' : ''}</p>}
          {needsReason && (
            <div className="mt-3 flex flex-col gap-1.5"><label htmlFor="imp-reason" className={labelClass}>Why are you changing marks? (kept in the mark history)</label>
              <input id="imp-reason" className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={confirm} loading={busy} disabled={review.counts.ok === 0 || !canEdit}>Import {review.counts.ok} mark{review.counts.ok === 1 ? '' : 's'}</Button>
            <Button variant="ghost" onClick={() => setReview(null)}>Start again</Button>
          </div>
          {review.counts.errors > 0 && <p className="mt-2 text-sm text-muted">Rows with errors are skipped. Fix them in the file and upload it again, or enter them in the grid.</p>}
        </Section>
      )}
    </div>
  );
}
