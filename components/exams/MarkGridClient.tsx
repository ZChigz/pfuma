'use client';

// Mark entry. Students down the side, assessments across the top, the calculated term mark and grade in the last columns.
//
//  Keyboard: type a mark and press Enter to go down, Tab to go across. Paste a column from Excel. AB, EX and NS are accepted in
//  any cell. A mark above the maximum, a negative number or text gets a red outline and a message in the cell.
//  Saving: every cell is written to this device first, then sent a moment later and when you leave a cell. "Saved", "Saving" or
//  "Offline, saved on this device" says where things stand, and anything typed offline is sent when the signal returns.
//  Phones: one assessment at a time as a list of students with a number pad.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, api, problem } from '@/components/academics/shared';
import { classStats, markKey, previewTermMarks, type StoredMark } from '@/lib/results';
import { cellText, parseCell, parsePaste, type TypedCode } from '@/lib/exams/cell';
import {
  SAVE_TEXT, enqueue, flush, idbMarkStore, memoryMarkStore, setReason, waitingCount, type MarkStore, type Outcome, type PendingCell, type SaveState, type SyncResponse,
} from '@/lib/exams/offline';
import type { Grid, GridColumn } from '@/lib/exams/marks';

const STATUS_VARIANT: Record<string, BadgeVariant> = { NOT_STARTED: 'neutral', IN_PROGRESS: 'info', SUBMITTED: 'warning', VERIFIED: 'success', PUBLISHED: 'success', RETURNED: 'danger', UNLOCKED: 'warning' };
const STATUS_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', VERIFIED: 'Verified', PUBLISHED: 'Published', RETURNED: 'Returned', UNLOCKED: 'Unlocked' };
const AUTOSAVE_MS = 2500;

async function post(batches: unknown[]): Promise<SyncResponse> {
  const res = await fetch('/api/exams/marks/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batches) });
  let json: SyncResponse['json'] = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

const colTitle = (c: GridColumn) => (c.stageName ? `${c.title}: ${c.stageName}` : c.title);
const fmtN = (n: number | null) => (n === null ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(1));

export function MarkGridClient({ grid }: { grid: Grid }) {
  const router = useRouter();
  const storeRef = useRef<MarkStore | null>(null);
  const store = useCallback(() => (storeRef.current ??= typeof indexedDB !== 'undefined' ? idbMarkStore() : memoryMarkStore()), []);

  // What is in each cell now (the server's version, plus what has been typed on this device).
  const [marks, setMarks] = useState(grid.marks);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverWarns, setServerWarns] = useState<Record<string, string>>({});
  const [state, setState] = useState<SaveState>('saved');
  const [online, setOnline] = useState(true);
  const [failedMsg, setFailedMsg] = useState<string | null>(null);
  const [reason, setReasonText] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [comments, setComments] = useState(grid.comments);
  const [phoneCol, setPhoneCol] = useState(0);
  const [submitCheck, setSubmitCheck] = useState<{ missing: { student: string; assessment: string }[]; total: number; problem: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const reasonRef = useRef(reason);
  reasonRef.current = reason;

  const editable = grid.canEdit;
  const editableCols = useMemo(() => grid.columns.filter((c) => !c.rubric), [grid.columns]);
  const needsReason = grid.sheet.needsReason;
  const keyOf = (studentId: string, c: Pick<GridColumn, 'assessmentId' | 'stageId'>) => markKey(studentId, c.assessmentId, c.stageId);

  // ── Sending ────────────────────────────────────────────────────────────────

  const refreshWaiting = useCallback(async () => {
    try { setWaiting(waitingCount(await store().all())); } catch { /* storage unavailable */ }
  }, [store]);

  const send = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const r = await flush(store(), post, { skipRef: (b) => needsReason && !(b.reason ?? reasonRef.current).trim() });
      setOnline(!r.offline);
      for (const [, outs] of Array.from(r.outcomes)) applyOutcomes(outs);
      for (const [, ws] of Array.from(r.warnings)) setServerWarns((w) => ({ ...w, ...Object.fromEntries(ws.map((x) => [x.key, x.message])) }));
      const failed = Array.from(r.failed.values())[0] ?? null;
      setFailedMsg(failed);
      const left = waitingCount(await store().all());
      setWaiting(left);
      setState(failed ? 'error' : r.offline && left > 0 ? 'offline' : left > 0 ? 'unsaved' : 'saved');
    } catch {
      setState('offline');
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, needsReason]);

  function applyOutcomes(outs: Outcome[]) {
    if (outs.length === 0) return;
    setErrors((e) => {
      const n = { ...e };
      for (const o of outs) if (o.status === 'rejected') n[o.key] = o.message ?? 'Not accepted';
      return n;
    });
    setMarks((m) => {
      const n = { ...m };
      for (const o of outs) if (o.status === 'stale') n[o.key] = { v: (o.value as number | null) ?? null, c: (o.code as never) ?? null, t: new Date().toISOString() };
      return n;
    });
    setDrafts((d) => {
      const n = { ...d };
      for (const o of outs) if (o.status === 'stale') delete n[o.key];
      return n;
    });
  }

  const schedule = useCallback((immediate = false) => {
    if (timer.current) clearTimeout(timer.current);
    setState((s) => (s === 'offline' ? s : 'unsaved'));
    timer.current = setTimeout(async () => { setState((s) => (s === 'offline' ? s : 'saving')); await send(); }, immediate ? 0 : AUTOSAVE_MS);
  }, [send]);

  // On first load: show anything still waiting on this device for this sheet, then send it.
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    setOnline(navigator.onLine);
    (async () => {
      try {
        const mine = await store().get(grid.assignmentId);
        if (mine) {
          setMarks((m) => {
            const n = { ...m };
            for (const [key, c] of Object.entries(mine.cells)) {
              const cur = n[key];
              if (!cur || cur.t <= c.changedAt) n[key] = { v: c.value, c: c.code, t: c.changedAt };
            }
            return n;
          });
          if (mine.reason) setReasonText(mine.reason);
          if (mine.state === 'FAILED') setFailedMsg(mine.message ?? null);
        }
      } catch { /* the page still works without storage */ }
      await refreshWaiting();
      void send();
    })();
    const on = () => { setOnline(true); schedule(true); };
    const off = () => { setOnline(false); setState('offline'); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const poll = setInterval(() => { if (navigator.onLine) void send(); }, 30_000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(poll); if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Typing ─────────────────────────────────────────────────────────────────

  async function commit(studentId: string, col: GridColumn, text: string) {
    const key = keyOf(studentId, col);
    const p = parseCell(text, col.max);
    if (!p.ok) {
      setErrors((e) => ({ ...e, [key]: p.message }));
      return;
    }
    setErrors((e) => { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; });
    setServerWarns((w) => { if (!(key in w)) return w; const n = { ...w }; delete n[key]; return n; });
    const at = new Date().toISOString();
    const cur = marks[key];
    if (cur && cur.v === p.cell.value && cur.c === p.cell.code) {
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      return;
    }
    setMarks((m) => ({ ...m, [key]: { v: p.cell.value, c: p.cell.code, t: at } }));
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    const cell: PendingCell = { studentId, assessmentId: col.assessmentId, stageId: col.stageId, value: p.cell.value, code: p.cell.code as TypedCode | null, changedAt: at };
    try {
      await enqueue(store(), grid.assignmentId, [cell], reasonRef.current.trim() || null);
      await refreshWaiting();
    } catch {
      toast.error('This device could not keep the mark. Check its storage.');
    }
    schedule();
  }

  function onChange(studentId: string, col: GridColumn, text: string) {
    const key = keyOf(studentId, col);
    setDrafts((d) => ({ ...d, [key]: text }));
    const p = parseCell(text, col.max);
    setErrors((e) => {
      if (p.ok) { if (!(key in e)) return e; const n = { ...e }; delete n[key]; return n; }
      return { ...e, [key]: p.message };
    });
  }

  function focusCell(row: number, col: number) {
    const sid = grid.students[row]?.id;
    const c = editableCols[col];
    if (!sid || !c) return;
    const el = inputs.current[keyOf(sid, c)];
    el?.focus();
    el?.select();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number, studentId: string, c: GridColumn) {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      void commit(studentId, c, e.currentTarget.value);
      const up = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey);
      focusCell(Math.min(Math.max(row + (up ? -1 : 1), 0), grid.students.length - 1), col);
    }
  }

  // Paste a column (or a block) from Excel: it fills down and across from the cell that was clicked.
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, row: number, col: number) {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n\r]/.test(text.trim())) return; // one value: the input handles it
    e.preventDefault();
    const block = parsePaste(text);
    let filled = 0;
    block.forEach((line, i) => {
      line.forEach((value, j) => {
        const s = grid.students[row + i];
        const c = editableCols[col + j];
        if (!s || !c) return;
        void commit(s.id, c, value);
        filled++;
      });
    });
    toast.info(filled === 1 ? 'Pasted 1 cell' : `Pasted ${filled} cells`);
  }

  async function saveReason(text: string) {
    setReasonText(text);
    try { await setReason(store(), grid.assignmentId, text); } catch { /* ignore */ }
    if (text.trim().length >= 3) schedule();
  }

  async function saveComment(studentId: string, text: string) {
    const before = comments[studentId] ?? '';
    if (text.trim() === before.trim()) return;
    setComments((c) => ({ ...c, [studentId]: text.trim() }));
    const r = await api('/api/exams/marks/sheet-comments', 'PUT', { assignmentId: grid.assignmentId, comments: [{ studentId, text: text.trim() || null }] });
    if (!r.ok) toast.error(problem(r));
  }

  // ── Live term marks and the class figures ──────────────────────────────────

  const lookup = useMemo(() => {
    const m = new Map<string, StoredMark>();
    for (const [k, v] of Object.entries(marks)) m.set(k, { value: v.v, code: v.c });
    return m;
  }, [marks]);

  const preview = useMemo(
    () => (grid.plan ? previewTermMarks({ plan: grid.plan, scale: grid.scale, assessments: grid.assessments, marks: lookup, studentIds: grid.students.map((s) => s.id) }) : null),
    [grid.plan, grid.scale, grid.assessments, grid.students, lookup],
  );

  const figures = useMemo(() => {
    const out: Record<string, { entered: number; mean: number | null; highest: number | null; lowest: number | null; pass: number | null }> = {};
    for (const c of grid.columns) {
      const cells = grid.students.map((s) => marks[keyOf(s.id, c)]);
      const values = cells.filter((m): m is NonNullable<typeof m> => !!m && m.v !== null).map((m) => m.v as number);
      const st = classStats(values, (grid.passMark / 100) * c.max);
      out[c.key] = { entered: cells.filter((m) => m && (m.v !== null || m.c !== null)).length, mean: st.mean, highest: st.highest, lowest: st.lowest, pass: st.passRate };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, grid.columns, grid.students, grid.passMark]);

  const totalCells = grid.students.length * grid.columns.filter((c) => c.countsToTerm).length;
  const filledCells = grid.students.reduce((n, s) => n + grid.columns.filter((c) => c.countsToTerm).filter((c) => { const m = marks[keyOf(s.id, c)]; return m && (m.v !== null || m.c !== null); }).length, 0);
  const completeStudents = grid.students.filter((s) => grid.columns.filter((c) => c.countsToTerm).every((c) => { const m = marks[keyOf(s.id, c)]; return m && (m.v !== null || m.c !== null); })).length;
  const errorList = Object.entries(errors);

  // ── Submitting ─────────────────────────────────────────────────────────────

  async function submit() {
    setBusy(true);
    await send();
    const check = await api(`/api/exams/sheets/${grid.assignmentId}/check`);
    if (!check.ok) { setBusy(false); return toast.error(problem(check)); }
    const d = check.body.data as { ready: boolean; problem: string | null; missing: { student: string; assessment: string }[]; missingTotal: number };
    if (!d.ready) { setBusy(false); setSubmitCheck({ missing: d.missing, total: d.missingTotal, problem: d.problem }); return; }
    const r = await api(`/api/exams/sheets/${grid.assignmentId}/submit`, 'POST');
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Submitted for verification');
    router.refresh();
  }

  const status = grid.sheet.status;
  const statusBadge = <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} label={STATUS_LABEL[status] ?? status} />;
  const stateTone = state === 'saved' ? 'text-success' : state === 'error' ? 'text-danger' : state === 'offline' ? 'text-warn' : 'text-muted';

  if (grid.columns.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-ink">{grid.subjectName}, {grid.className}</h2>{statusBadge}</div>
        <p className="mt-2 text-sm text-muted">No assessments yet. Create a test, assignment or project for this class to start entering marks.</p>
        {editable && <Link href={`/exams/marks/${grid.assignmentId}/assessments`} className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">Create an assessment</Link>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Where the sheet stands */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{grid.subjectName}, {grid.className}</h2>
            {statusBadge}
          </div>
          <p className="mt-0.5 text-sm text-muted">{grid.termName} · {grid.teacherName} · {completeStudents} of {grid.students.length} students complete</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', stateTone)}>
            <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', state === 'saved' ? 'bg-success' : state === 'error' ? 'bg-danger' : state === 'offline' ? 'bg-warn' : 'animate-pulse bg-muted')} />
            {SAVE_TEXT[state]}{waiting > 0 && state !== 'saved' ? ` (${waiting} waiting)` : ''}
          </span>
          <Link href={`/exams/marks/${grid.assignmentId}/import`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint">Import</Link>
          {editable && <Button onClick={submit} loading={busy} disabled={!online && waiting > 0}>Submit for verification</Button>}
        </div>
      </div>

      {grid.planProblem && <Notice tone="warn">{grid.planProblem} Marks can be entered, but the term mark cannot be calculated until then.</Notice>}
      {status === 'SUBMITTED' && <Notice tone="info">This sheet is waiting for verification, so the marks are locked.</Notice>}
      {(status === 'VERIFIED' || status === 'PUBLISHED') && <Notice tone="info">This sheet is {STATUS_LABEL[status!].toLowerCase()} and locked. Only the Head can open it again.</Notice>}
      {status === 'RETURNED' && grid.sheet.returnedComment && <Notice tone="danger"><strong>Returned by the verifier:</strong> {grid.sheet.returnedComment}</Notice>}
      {status === 'UNLOCKED' && grid.sheet.unlockReason && <Notice tone="warn"><strong>Opened by the Head for correction:</strong> {grid.sheet.unlockReason}</Notice>}
      {failedMsg && <Notice tone="danger"><strong>Marks on this device were not accepted:</strong> {failedMsg} They are still kept on this device.</Notice>}
      {editable && needsReason && (
        <div className="rounded-2xl border border-warn-line bg-warn-bg p-4">
          <label htmlFor="reason" className="text-sm font-semibold text-warn">This sheet has been submitted before, so every change is kept in the mark history. Why are you changing marks?</label>
          <input id="reason" value={reason} onChange={(e) => void saveReason(e.target.value)} maxLength={300} placeholder="For example: exam script 3 was marked out of the wrong paper"
            className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none" />
          {reason.trim().length < 3 && waiting > 0 && <p className="mt-1 text-xs text-warn">Your changes are saved on this device and are sent as soon as you give a reason.</p>}
        </div>
      )}
      {errorList.length > 0 && (
        <div role="alert" className="rounded-xl border border-danger-line bg-danger-bg px-4 py-3 text-sm text-danger">
          <strong>{errorList.length} cell{errorList.length === 1 ? ' needs' : 's need'} attention:</strong>{' '}
          {errorList.slice(0, 4).map(([k, m]) => { const [sid, aid, stid] = k.split('|'); const s = grid.students.find((x) => x.id === sid); const c = grid.columns.find((x) => x.assessmentId === aid && (x.stageId ?? '') === (stid ?? '')); return `${s?.name ?? ''} (${c ? colTitle(c) : ''}): ${m}`; }).join('; ')}{errorList.length > 4 ? ' ...' : ''}
        </div>
      )}

      {/* Desktop and tablet: the grid */}
      <div className="hidden overflow-auto rounded-2xl bg-white md:block" style={{ maxHeight: '70vh' }}>
        <table className="min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 min-w-[210px] border-b border-line bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Student</th>
              {grid.columns.map((c) => (
                <th key={c.key} scope="col" className="sticky top-0 z-20 min-w-[92px] border-b border-line bg-white px-2 py-2 text-center align-bottom">
                  <div className="max-w-[120px] truncate text-xs font-semibold text-ink" title={colTitle(c)}>{c.title}</div>
                  {c.stageName && <div className="max-w-[120px] truncate text-[11px] text-muted" title={c.stageName}>{c.stageName}</div>}
                  <div className="text-[11px] text-muted">{c.typeName} · /{c.max}{!c.countsToTerm ? ' · not counted' : ''}{c.common ? ' · all classes' : ''}</div>
                </th>
              ))}
              <th scope="col" className="sticky top-0 z-20 min-w-[78px] border-b border-l border-line bg-tint px-2 py-2 text-center text-xs font-semibold text-ink">Term mark</th>
              <th scope="col" className="sticky top-0 z-20 min-w-[56px] border-b border-line bg-tint px-2 py-2 text-center text-xs font-semibold text-ink">Grade</th>
              {grid.commentsEnabled && <th scope="col" className="sticky top-0 z-20 min-w-[220px] border-b border-line bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Comment</th>}
            </tr>
          </thead>
          <tbody>
            {grid.students.map((s, row) => {
              const p = preview?.get(s.id);
              return (
                <tr key={s.id} className="group">
                  <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5 text-left font-medium text-ink group-hover:bg-tint">
                    <div className="truncate" title={s.name}>{s.name}</div>
                    <div className="text-[11px] font-normal text-muted">{s.admissionNumber}</div>
                  </th>
                  {grid.columns.map((c) => {
                    const key = keyOf(s.id, c);
                    const m = marks[key];
                    if (c.rubric) {
                      return (
                        <td key={c.key} className="border-b border-line px-1 py-1 text-center">
                          <Link href={`/exams/marks/${grid.assignmentId}/rubric?assessmentId=${c.assessmentId}&stageId=${c.stageId}&studentId=${s.id}`} className="inline-block min-w-[64px] rounded-lg border border-line px-2 py-1.5 text-xs font-semibold text-primary hover:bg-tint">
                            {m?.v !== null && m?.v !== undefined ? m.v : 'Rubric'}
                          </Link>
                        </td>
                      );
                    }
                    const col = editableCols.indexOf(c);
                    const err = errors[key];
                    const warn = serverWarns[key] ?? grid.warnings[key];
                    const text = drafts[key] ?? cellText(m ? { value: m.v, code: m.c } : undefined);
                    return (
                      <td key={c.key} className="border-b border-line px-1 py-1 text-center">
                        <input
                          ref={(el) => { inputs.current[key] = el; }}
                          value={text}
                          readOnly={!editable}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={`${s.name}, ${colTitle(c)}, out of ${c.max}`}
                          aria-invalid={err ? true : undefined}
                          aria-describedby={err ? `err-${key}` : undefined}
                          title={err ?? warn ?? (m?.c ? ({ AB: 'Absent', EX: 'Exempt', NS: 'Not submitted (counts as 0)', AB_EXCUSED: 'Absence excused by the Head' } as Record<string, string>)[m.c] : undefined)}
                          onChange={(e) => onChange(s.id, c, e.target.value)}
                          onBlur={(e) => { if (editable && (drafts[key] !== undefined || errors[key])) void commit(s.id, c, e.target.value); }}
                          onKeyDown={(e) => onKeyDown(e, row, col, s.id, c)}
                          onPaste={(e) => onPaste(e, row, col)}
                          onFocus={(e) => e.target.select()}
                          className={cn(
                            'h-10 w-[84px] rounded-lg border px-2 text-center text-sm tabular-nums focus:outline-none focus:ring-2',
                            err ? 'border-danger bg-danger-bg text-danger ring-danger/30 focus:ring-danger/40' : warn ? 'border-warn bg-warn-bg focus:ring-warn/40' : 'border-line bg-white focus:border-primary focus:ring-primary/30',
                            !editable && 'bg-canvas text-muted',
                            m?.c === 'AB' || m?.c === 'NS' ? 'font-semibold text-warn' : '',
                          )}
                        />
                        {err && <span id={`err-${key}`} className="sr-only">{err}</span>}
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-line bg-tint px-2 py-1.5 text-center font-semibold tabular-nums text-ink">
                    {p?.roundedMark != null ? p.roundedMark : '-'}{p?.incomplete && p.roundedMark != null ? <span className="ml-0.5 text-warn" title="Some marks are not entered yet">*</span> : null}
                  </td>
                  <td className="border-b border-line bg-tint px-2 py-1.5 text-center font-semibold text-ink">{p?.grade ?? '-'}</td>
                  {grid.commentsEnabled && (
                    <td className="border-b border-line px-1 py-1">
                      <input defaultValue={comments[s.id] ?? ''} readOnly={status === 'PUBLISHED'} maxLength={300} aria-label={`Comment for ${s.name}`} placeholder="Short comment"
                        onBlur={(e) => void saveComment(s.id, e.target.value)}
                        className="h-10 w-full rounded-lg border border-line bg-white px-2 text-sm focus:border-primary focus:outline-none" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {([['Entered', (f: (typeof figures)[string]) => `${f.entered}/${grid.students.length}`], ['Mean', (f: (typeof figures)[string]) => fmtN(f.mean)], ['Highest', (f: (typeof figures)[string]) => fmtN(f.highest)], ['Lowest', (f: (typeof figures)[string]) => fmtN(f.lowest)], ['Pass rate', (f: (typeof figures)[string]) => (f.pass === null ? '-' : `${Math.round(f.pass)}%`)]] as const).map(([label, fn]) => (
              <tr key={label}>
                <th scope="row" className="sticky left-0 z-10 border-b border-line bg-canvas px-3 py-1 text-left text-xs font-semibold text-muted">{label}</th>
                {grid.columns.map((c) => <td key={c.key} className="border-b border-line bg-canvas px-1 py-1 text-center text-xs tabular-nums text-ink">{fn(figures[c.key]!)}</td>)}
                <td className="border-b border-l border-line bg-canvas" colSpan={2 + (grid.commentsEnabled ? 1 : 0)} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>

      {/* Phones: one assessment at a time */}
      <div className="md:hidden">
        <label htmlFor="phone-col" className="sr-only">Assessment</label>
        <select id="phone-col" value={phoneCol} onChange={(e) => setPhoneCol(Number(e.target.value))} className="mb-3 h-12 w-full rounded-xl border border-line bg-white px-3 text-base font-semibold text-ink">
          {grid.columns.map((c, i) => <option key={c.key} value={i}>{colTitle(c)} (out of {c.max}) · {figures[c.key]!.entered}/{grid.students.length}</option>)}
        </select>
        {(() => {
          const c = grid.columns[phoneCol] ?? grid.columns[0]!;
          return (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white">
              {grid.students.map((s) => {
                const key = keyOf(s.id, c);
                const m = marks[key];
                const err = errors[key];
                const warn = serverWarns[key] ?? grid.warnings[key];
                const text = drafts[key] ?? cellText(m ? { value: m.v, code: m.c } : undefined);
                return (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.admissionNumber}{err ? <span className="ml-2 text-danger">{err}</span> : warn ? <span className="ml-2 text-warn">Check this mark</span> : null}</div>
                    </div>
                    {c.rubric ? (
                      <Link href={`/exams/marks/${grid.assignmentId}/rubric?assessmentId=${c.assessmentId}&stageId=${c.stageId}&studentId=${s.id}`} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-primary">{m?.v ?? 'Rubric'}</Link>
                    ) : (
                      <>
                        <input value={text} readOnly={!editable} inputMode="decimal" autoComplete="off" aria-label={`${s.name}, mark out of ${c.max}`} aria-invalid={err ? true : undefined}
                          onChange={(e) => onChange(s.id, c, e.target.value)} onBlur={(e) => { if (editable && (drafts[key] !== undefined || errors[key])) void commit(s.id, c, e.target.value); }}
                          className={cn('h-12 w-20 rounded-xl border px-2 text-center text-lg tabular-nums focus:outline-none focus:ring-2', err ? 'border-danger bg-danger-bg text-danger focus:ring-danger/40' : warn ? 'border-warn bg-warn-bg' : 'border-line bg-white focus:border-primary focus:ring-primary/30')} />
                        {editable && (
                          <div className="flex gap-1" role="group" aria-label={`Codes for ${s.name}`}>
                            {(['AB', 'EX', 'NS'] as const).map((code) => (
                              <button key={code} type="button" onClick={() => void commit(s.id, c, m?.c === code ? '' : code)} aria-pressed={m?.c === code}
                                className={cn('h-12 min-w-[44px] rounded-xl border text-xs font-bold', m?.c === code ? 'border-primary bg-primary text-white' : 'border-line bg-white text-muted')}>{code}</button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })()}
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={phoneCol === 0} onClick={() => setPhoneCol((i) => Math.max(0, i - 1))}>Previous</Button>
          <Button variant="secondary" className="flex-1" disabled={phoneCol >= grid.columns.length - 1} onClick={() => setPhoneCol((i) => Math.min(grid.columns.length - 1, i + 1))}>Next</Button>
        </div>
        {preview && <p className="mt-3 text-center text-xs text-muted">Term marks appear on a laptop, or on the verification screen.</p>}
      </div>

      <p className="text-xs text-muted">
        Type a mark and press <kbd className="rounded border border-line px-1">Enter</kbd> to go down, <kbd className="rounded border border-line px-1">Tab</kbd> to go across, or paste a column from Excel.
        Use AB for absent, EX for exempt and NS for not submitted (counts as 0). {filledCells} of {totalCells} marks entered.
      </p>

      <Modal open={!!submitCheck} onClose={() => setSubmitCheck(null)} title="This sheet cannot be submitted yet">
        {submitCheck?.problem ? <p className="text-sm text-ink">{submitCheck.problem}</p> : (
          <>
            <p className="text-sm text-ink">{submitCheck?.total} mark{submitCheck?.total === 1 ? ' is' : 's are'} missing. Every student needs a mark, AB, EX or NS for every assessment that counts.</p>
            <ul className="mt-3 max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm text-ink">
              {submitCheck?.missing.map((m, i) => <li key={i}>{m.student}: {m.assessment}</li>)}
            </ul>
            {submitCheck && submitCheck.total > submitCheck.missing.length && <p className="mt-2 text-xs text-muted">and {submitCheck.total - submitCheck.missing.length} more</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
