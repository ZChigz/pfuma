'use client';

// The Head's view of the term: "34 of 48 mark sheets verified", the count in each state, and the overdue sheets by teacher with a
// Remind button that sends each teacher a notice.
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Section, SheetBadge, SHEET_LABEL, api, problem } from '@/components/exams/shared';
import type { TermProgress } from '@/lib/exams/sheets';

const ORDER = ['NOT_STARTED', 'IN_PROGRESS', 'RETURNED', 'UNLOCKED', 'SUBMITTED', 'VERIFIED', 'PUBLISHED'] as const;
const LATE_TEXT = { entry: 'marks not started', submission: 'not submitted', verification: 'not verified' } as const;

export function ProgressClient({ progress: p, canRemind }: { progress: TermProgress; canRemind: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const pct = p.total ? Math.round((p.verified / p.total) * 100) : 0;

  async function remind(teacherIds: string[]) {
    setBusy(teacherIds.join(','));
    const r = await api('/api/exams/remind', 'POST', { termId: p.termId, teacherIds });
    setBusy(null);
    if (!r.ok) return toast.error(problem(r));
    setDone((d) => ({ ...d, ...Object.fromEntries(teacherIds.map((t) => [t, true])) }));
    toast.success(teacherIds.length === 1 ? 'Reminder sent' : `${teacherIds.length} reminders sent`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title={p.termName} hint={[p.deadlines.entryDue && `Entry ${p.deadlines.entryDue}`, p.deadlines.submitDue && `submission ${p.deadlines.submitDue}`, p.deadlines.verifyDue && `verification ${p.deadlines.verifyDue}`].filter(Boolean).join(' · ') || 'No dates set yet. The Exams Officer sets them under Assessment setup.'}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-3xl font-bold tabular-nums text-ink">{p.verified} <span className="text-lg font-medium text-muted">of {p.total}</span></div><div className="text-sm text-muted">{p.progressText}</div></div>
          <div className="min-w-[220px] flex-1"><div className="h-3 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Mark sheets verified"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div></div>
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {ORDER.map((s) => <li key={s} className="rounded-xl border border-line p-3"><div className="text-2xl font-semibold tabular-nums text-ink">{p.byStatus[s]}</div><div className="text-xs text-muted">{SHEET_LABEL[s]}</div></li>)}
        </ul>
      </Section>

      <Section title="Overdue by teacher" action={canRemind && p.overdue.length > 1 ? <Button size="sm" variant="secondary" onClick={() => remind(p.overdue.map((o) => o.teacherId))} loading={busy !== null && busy.includes(',')}>Remind everyone</Button> : undefined}>
        {p.overdue.length === 0 ? <p className="text-sm text-muted">Nothing is overdue.</p> : (
          <ul className="flex flex-col gap-3">
            {p.overdue.map((o) => (
              <li key={o.teacherId} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{o.teacher} <span className="font-normal text-muted">· {o.sheets.length} sheet{o.sheets.length === 1 ? '' : 's'}</span></h3>
                  {canRemind && <Button size="sm" variant="secondary" onClick={() => remind([o.teacherId])} loading={busy === o.teacherId} disabled={done[o.teacherId]}>{done[o.teacherId] ? 'Reminded' : 'Remind'}</Button>}
                </div>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {o.sheets.map((s) => (
                    <li key={s.assignmentId} className="flex flex-wrap items-center gap-2"><Link className="font-medium text-primary hover:underline" href={`/exams/verify/${s.assignmentId}`}>{s.label}</Link><SheetBadge status={s.status} /><span className="text-muted">{LATE_TEXT[s.late]}</span></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
