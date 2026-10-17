'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { isException, OUTCOME_LABEL, type Outcome } from '@/lib/students/promotion-rules';
import type { PromotionState } from '@/lib/students/promotion';
import { api, Checkbox, formatDay, problem, Section, useBusy } from '@/components/students/shared';

const STEPS = ['New year', 'Proposed moves', 'Exceptions', 'Review', 'Confirm'];
type Decision = { outcome: Outcome; toClassId: string | null; exitReason: string | null; note: string | null };

const LEAVE_REASONS = [['TRANSFER', 'Transfer to another school'], ['WITHDRAWN_BY_GUARDIAN', 'Withdrawn by guardian'], ['RELOCATED_ABROAD', 'Relocated outside Zimbabwe'], ['DECEASED', 'Deceased'], ['OTHER', 'Other']];

export function PromotionClient({ state, canApprove, years, runId }: { state: PromotionState; canApprove: boolean; years: { id: string; year: number }[]; runId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(state.draft ? 2 : 0);
  // Decisions that differ from the proposal, by student; everyone else keeps the proposal.
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const d: Record<string, Decision> = {};
    for (const l of state.lines) if (isException(l) || l.note) d[l.studentId] = { outcome: l.outcome, toClassId: l.toClassId, exitReason: l.outcome === 'LEAVE' ? l.exitReason : null, note: l.note };
    return d;
  });
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [classFilter, setClassFilter] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const { busy, run } = useBusy();

  const lines = useMemo(() => state.lines.map((l) => {
    const d = decisions[l.studentId];
    return d ? { ...l, outcome: d.outcome, toClassId: d.toClassId, exitReason: (d.exitReason ?? (d.outcome === 'COMPLETE' ? l.exitReason : null)) as typeof l.exitReason, note: d.note } : l;
  }), [state.lines, decisions]);
  const shown = lines.filter((l) => (!onlyExceptions || isException(l) || !!decisions[l.studentId]) && (!classFilter || l.fromClassId === classFilter));
  const fromClasses = Array.from(new Map(state.lines.map((l) => [l.fromClassId, l.fromClassName])).entries());
  const classesByLevel = (level: number) => state.classes.filter((c) => c.levelOrder === level);

  const set = (ids: string[], d: Decision | null) => setDecisions((cur) => { const n = { ...cur }; for (const id of ids) { if (d) n[id] = d; else delete n[id]; } return n; });
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const body = () => ({ fromYearId: state.fromYear.id, decisions: Object.entries(decisions).map(([studentId, d]) => ({ studentId, outcome: d.outcome, toClassId: d.toClassId ?? undefined, exitReason: d.exitReason ?? undefined, note: d.note ?? undefined })) });

  async function save(then?: number) {
    const r = await run(() => api('/api/students/promotion', 'PUT', body()));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return false; }
    setError(''); toast.success('Draft saved. Nothing has changed for any student yet.'); router.refresh();
    if (then !== undefined) setStep(then);
    return true;
  }
  async function confirm() {
    if (!(await save())) return;
    const draft = await api(`/api/students/promotion?fromYearId=${state.fromYear.id}`);
    const id = draft.ok ? (draft.body.data.promotion?.draft?.id as string | undefined) : undefined;
    if (!id) { setError('The draft could not be found. Save it and try again.'); return; }
    const r = await run(() => api(`/api/students/promotion/${id}/confirm`, 'POST', { acknowledgeFull: ack }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Promotion confirmed');
    window.open(`/api/students/promotion/${id}/report`, '_blank');
    router.refresh();
  }

  if (state.confirmed) return (
    <Section title={`The ${state.fromYear.year} promotion is done`}>
      <p className="text-sm text-ink">Confirmed {formatDay(state.confirmed.at)} by {state.confirmed.approvedBy}.</p>
      {runId && <a href={`/api/students/promotion/${runId}/report`} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white">Open the report (PDF)</a>}
    </Section>
  );

  const review = (() => {
    const counts: Record<string, number> = {};
    for (const l of lines) counts[l.outcome] = (counts[l.outcome] ?? 0) + 1;
    return counts;
  })();
  const perClass = new Map<string, { name: string; n: number; capacity: number | null; created: boolean }>();
  for (const l of lines) {
    if (l.outcome === 'LEAVE' || l.outcome === 'COMPLETE') continue;
    const klass = state.classes.find((c) => c.id === (l.outcome === 'REPEAT' ? l.fromClassId : l.toClassId));
    const name = klass?.name ?? l.toClassName ?? '—';
    const e = perClass.get(name) ?? { name, n: 0, capacity: klass?.capacity ?? 45, created: !klass };
    e.n++; perClass.set(name, e);
  }
  const over = Array.from(perClass.values()).filter((c) => c.capacity !== null && c.n > c.capacity);
  const leavers = lines.filter((l) => l.outcome === 'LEAVE' || l.outcome === 'COMPLETE');

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
        {STEPS.map((l, i) => <li key={l} className="flex-1"><button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined} className={cn('min-h-[44px] w-full whitespace-nowrap rounded-xl px-2 text-xs font-semibold sm:text-sm', i === step ? 'bg-primary text-white' : i < step ? 'bg-tint text-primary' : 'bg-white text-muted')}>{i + 1}. {l}</button></li>)}
      </ol>
      {error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
      {state.draft && <p className="text-xs text-muted">A draft is saved ({state.draft.decisions} decision{state.draft.decisions === 1 ? '' : 's'} that differ from the proposal). Nothing changes for any student until it is confirmed.</p>}
      {state.changedSinceDraft > 0 && <p role="alert" className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">{state.changedSinceDraft} student(s) in the draft have since left or changed class. Save the draft again to update it.</p>}

      {step === 0 && (
        <Section title="Choose the new year">
          {years.length > 1 && <Select id="py" label="Promote the year" value={state.fromYear.id} onChange={(e) => router.push(`/students/promotion?fromYearId=${e.target.value}`)} options={years.map((y) => ({ value: y.id, label: `${y.year} to ${y.year + 1}` }))} />}
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            <li>{state.term3.status === 'CLOSED' ? '✓' : '✗'} {state.term3.name} is {state.term3.status.toLowerCase()}</li>
            <li>{state.toYear ? '✓' : '✗'} The {state.fromYear.year + 1} academic year {state.toYear ? 'exists' : 'does not exist yet'}</li>
            <li>{state.term1 ? '✓' : '✗'} {state.term1 ? state.term1.name : 'Term 1 of the new year is missing'}</li>
          </ul>
          {state.problems.map((p) => <p key={p} role="alert" className="mt-2 text-sm text-danger">{p}</p>)}
          <div className="mt-4"><Button disabled={state.problems.length > 0} onClick={() => setStep(1)}>Continue</Button></div>
        </Section>
      )}

      {(step === 1 || step === 2) && (
        <Section title={step === 1 ? `Proposed moves (${lines.length} students)` : 'Exceptions'}>
          <p className="mb-3 text-sm text-muted">{step === 1 ? 'Everyone moves to the next form in the same stream. Form 4 completes O Level, Upper 6 completes A Level, Lower 6 moves up to Upper 6. Check it, then change the exceptions.' : 'Change what happens to a student, or tick several (or a whole class) and change them together.'}</p>
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <Select id="pf" aria-label="Class" placeholder="All classes" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} options={fromClasses.map(([value, label]) => ({ value, label }))} />
            <Checkbox label="Show exceptions only" checked={onlyExceptions} onChange={setOnlyExceptions} />
            {classFilter && <Button size="sm" variant="secondary" onClick={() => setPicked(new Set(shown.map((l) => l.studentId)))}>Tick this whole class</Button>}
          </div>
          {step === 2 && picked.size > 0 && <BulkBar ids={Array.from(picked)} lines={lines} classesByLevel={classesByLevel} set={set} clear={() => setPicked(new Set())} />}
          <ul className="flex flex-col divide-y divide-line">
            {shown.slice(0, 300).map((l) => {
              const d = decisions[l.studentId];
              return (
                <li key={l.studentId} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {step === 2 && <input type="checkbox" aria-label={`Tick ${l.fullName}`} checked={picked.has(l.studentId)} onChange={() => toggle(l.studentId)} className="h-5 w-5 flex-shrink-0" />}
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{l.fullName}</p><p className="text-xs text-muted">{l.fromClassName}</p></div>
                  </div>
                  {step === 1 ? (
                    <p className="text-sm text-ink">{summary(l, state)}</p>
                  ) : (
                    <DecisionEditor line={l} decided={!!d} classesByLevel={classesByLevel} onChange={(nd) => set([l.studentId], nd)} />
                  )}
                </li>
              );
            })}
          </ul>
          {shown.length > 300 && <p className="mt-2 text-xs text-muted">Showing 300 of {shown.length}. Filter by class to see the rest.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>
            <Button variant="secondary" loading={busy} onClick={() => save()}>Save draft</Button>
            <Button loading={busy} onClick={() => save(step + 1)}>Continue</Button>
          </div>
        </Section>
      )}

      {step === 3 && (
        <Section title="Review">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(review).map(([k, n]) => <div key={k} className="rounded-xl bg-canvas p-3 text-center"><div className="text-2xl font-bold">{n}</div><div className="text-xs text-muted">{OUTCOME_LABEL[k as Outcome]}</div></div>)}</div>
          <h3 className="mt-4 text-sm font-semibold">New classes</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {Array.from(perClass.values()).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })).map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 py-2 text-sm"><span>{c.name}{c.created && <span className="ml-2 text-xs text-muted">(made on confirmation)</span>}</span>
                <span className={cn(c.capacity !== null && c.n > c.capacity ? 'font-semibold text-danger' : 'text-ink')}>{c.n} of {c.capacity}{c.capacity !== null && c.n > c.capacity ? ` · ${c.n - c.capacity} over` : ''}</span></li>
            ))}
          </ul>
          <h3 className="mt-4 text-sm font-semibold">Leaving the school ({leavers.length})</h3>
          {leavers.length === 0 ? <p className="text-sm text-muted">Nobody.</p> : <ul className="mt-1 max-h-64 overflow-y-auto text-sm">{leavers.map((l) => <li key={l.studentId} className="flex justify-between gap-2 py-1"><span>{l.fullName} <span className="text-xs text-muted">{l.fromClassName}</span></span><Badge variant="neutral" label={l.exitReason ? l.exitReason.toLowerCase().replace(/_/g, ' ') : 'reason needed'} /></li>)}</ul>}
          <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)}>Continue</Button></div>
        </Section>
      )}

      {step === 4 && (
        <Section title="Confirm">
          <p className="text-sm text-ink">Confirming creates Term 1 {state.toYear?.year} classes for {lines.length - leavers.length} students, ends their {state.term3.name} classes, sets the status of {leavers.length} leaver{leavers.length === 1 ? '' : 's'}, and writes an audit entry for every student. It cannot be undone, and each year is confirmed once.</p>
          {over.length > 0 && <div className="mt-3"><Checkbox label={`${over.map((c) => `${c.name} would have ${c.n} students (capacity ${c.capacity})`).join('; ')}. Go ahead anyway.`} checked={ack} onChange={setAck} /></div>}
          {canApprove ? <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setStep(3)}>Back</Button><Button variant="danger" loading={busy} onClick={confirm} disabled={over.length > 0 && !ack}>Confirm the promotion</Button></div>
            : <><p role="note" className="mt-3 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">The Head must approve the promotion. Save the draft and ask them to open this page.</p><div className="mt-3 flex gap-2"><Button variant="ghost" onClick={() => setStep(3)}>Back</Button><Button variant="secondary" loading={busy} onClick={() => save()}>Save draft</Button></div></>}
        </Section>
      )}
    </div>
  );
}

function summary(l: PromotionState['lines'][number], state: PromotionState) {
  if (l.outcome === 'COMPLETE') return l.fromLevel === 6 ? 'Completes A Level (graduates)' : 'Completes O Level (graduates)';
  if (l.outcome === 'LEAVE') return `Leaves${l.exitReason ? `: ${l.exitReason.toLowerCase().replace(/_/g, ' ')}` : ''}`;
  if (l.outcome === 'REPEAT') return `Repeats ${l.fromClassName}`;
  return `${OUTCOME_LABEL[l.outcome]}: ${state.classes.find((c) => c.id === l.toClassId)?.name ?? l.toClassName ?? '—'}`;
}

function DecisionEditor({ line, decided, classesByLevel, onChange }: { line: PromotionState['lines'][number]; decided: boolean; classesByLevel: (n: number) => PromotionState['classes']; onChange: (d: Decision | null) => void }) {
  const level = line.outcome === 'MOVE_STREAM' || line.outcome === 'PROMOTE' ? line.fromLevel + 1 : line.outcome === 'CONTINUE_LOWER_6' ? 5 : line.fromLevel;
  const options: [Outcome, string][] = line.fromLevel === 4
    ? [['COMPLETE', 'Completed O Level'], ['CONTINUE_LOWER_6', 'Continue to Lower 6'], ['REPEAT', 'Repeat'], ['OTHER_CLASS', 'Another class'], ['LEAVE', 'Leave']]
    : line.fromLevel === 6 ? [['COMPLETE', 'Graduated'], ['REPEAT', 'Repeat'], ['OTHER_CLASS', 'Another class'], ['LEAVE', 'Leave']]
    : [['PROMOTE', 'Move up'], ['REPEAT', 'Repeat'], ['MOVE_STREAM', 'Move up to another stream'], ['OTHER_CLASS', 'Another class'], ['LEAVE', 'Leave']];
  const needsClass = line.outcome === 'MOVE_STREAM' || line.outcome === 'OTHER_CLASS' || line.outcome === 'CONTINUE_LOWER_6';
  const pick = (outcome: Outcome) => onChange({ outcome, toClassId: null, exitReason: outcome === 'LEAVE' ? 'WITHDRAWN_BY_GUARDIAN' : null, note: null });
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <select aria-label={`What happens to ${line.fullName}`} value={line.outcome} onChange={(e) => pick(e.target.value as Outcome)} className="min-h-[44px] rounded-xl border border-line bg-white px-2 text-sm">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {needsClass && (
        <select aria-label="Class" value={line.toClassId ?? ''} onChange={(e) => onChange({ outcome: line.outcome, toClassId: e.target.value || null, exitReason: null, note: null })} className="min-h-[44px] rounded-xl border border-line bg-white px-2 text-sm">
          <option value="">{line.outcome === 'CONTINUE_LOWER_6' ? 'Same stream (made if needed)' : 'Choose a class'}</option>
          {(line.outcome === 'OTHER_CLASS' ? [1, 2, 3, 4, 5, 6].flatMap((n) => classesByLevel(n)) : classesByLevel(level)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      {line.outcome === 'LEAVE' && (
        <>
          <select aria-label="Why" value={line.exitReason ?? ''} onChange={(e) => onChange({ outcome: 'LEAVE', toClassId: null, exitReason: e.target.value, note: line.note })} className="min-h-[44px] rounded-xl border border-line bg-white px-2 text-sm">
            {LEAVE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {line.exitReason === 'OTHER' && <input aria-label="Say what the reason is" placeholder="Reason" value={line.note ?? ''} onChange={(e) => onChange({ outcome: 'LEAVE', toClassId: null, exitReason: 'OTHER', note: e.target.value })} className="min-h-[44px] rounded-xl border border-line px-2 text-sm" />}
        </>
      )}
      {decided && <button type="button" onClick={() => onChange(null)} className="min-h-[44px] px-2 text-xs text-muted underline">Reset</button>}
    </div>
  );
}

function BulkBar({ ids, lines, classesByLevel, set, clear }: { ids: string[]; lines: PromotionState['lines']; classesByLevel: (n: number) => PromotionState['classes']; set: (ids: string[], d: Decision | null) => void; clear: () => void }) {
  const levels = Array.from(new Set(ids.map((id) => lines.find((l) => l.studentId === id)!.fromLevel)));
  const one = levels.length === 1 ? levels[0]! : null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-ink p-3 text-white">
      <span className="mr-auto text-sm font-semibold">{ids.length} ticked</span>
      <Button size="sm" variant="secondary" onClick={() => set(ids, { outcome: 'REPEAT', toClassId: null, exitReason: null, note: null })}>Repeat</Button>
      {one !== null && one !== 4 && one !== 6 && <Button size="sm" variant="secondary" onClick={() => set(ids, null)}>Move up (proposal)</Button>}
      {one === 4 && <Button size="sm" variant="secondary" onClick={() => set(ids, { outcome: 'CONTINUE_LOWER_6', toClassId: null, exitReason: null, note: null })}>Continue to Lower 6</Button>}
      {one !== null && one !== 4 && one !== 6 && (
        <select aria-label="Move up to another stream" defaultValue="" onChange={(e) => e.target.value && set(ids, { outcome: 'MOVE_STREAM', toClassId: e.target.value, exitReason: null, note: null })} className="min-h-[44px] rounded-xl bg-white px-2 text-sm text-ink">
          <option value="">Move up to another stream…</option>{classesByLevel(one + 1).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <Button size="sm" variant="secondary" onClick={() => set(ids, { outcome: 'LEAVE', toClassId: null, exitReason: 'WITHDRAWN_BY_GUARDIAN', note: null })}>Leave</Button>
      <button type="button" onClick={clear} className="min-h-[44px] px-2 text-sm underline">Clear</button>
    </div>
  );
}
