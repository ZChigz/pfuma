'use client';

// The verification screen: the marks beside the other classes of the same subject, the grade spread, flagged outliers, the
// history of changes, and the three things a person can do with a submitted sheet: verify it, return it with a comment, and
// (the Head) unlock it with a reason. Each is a named action by a named person, kept in the sheet's history.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, Section, SheetBadge, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import { markKey } from '@/lib/results';
import type { Review } from '@/lib/exams/sheets';

const ACTION_TEXT: Record<string, string> = { SUBMIT: 'Submitted', VERIFY: 'Verified', RETURN: 'Returned', UNLOCK: 'Unlocked', PUBLISH: 'Published', UNPUBLISH: 'Unpublished' };

export function ReviewClient({ review, flags }: { review: Review; flags: { unlock: boolean; verify: boolean } }) {
  const router = useRouter();
  const g = review.grid;
  const [modal, setModal] = useState<'return' | 'unlock' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const status = g.sheet.status;
  const maxSpread = Math.max(1, ...review.gradeSpread.map((s) => s.count));

  async function act(path: 'verify' | 'return' | 'unlock', payload?: unknown) {
    setBusy(true);
    const r = await api(`/api/exams/sheets/${g.assignmentId}/${path}`, 'POST', payload);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(path === 'verify' ? 'Verified. The marks are locked.' : path === 'return' ? 'Returned to the teacher' : 'Unlocked and sent back to the teacher');
    setModal(null);
    setText('');
    router.refresh();
  }

  async function excuse(studentId: string, assessmentId: string, stageId: string | null) {
    const reason = window.prompt('Why is this absence excused? (kept in the mark history)');
    if (!reason || reason.trim().length < 3) return;
    const r = await api('/api/exams/marks/excuse', 'POST', { assignmentId: g.assignmentId, assessmentId, studentId, stageId, reason: reason.trim() });
    if (!r.ok) return toast.error(problem(r));
    toast.success('Absence excused. The assessment is left out of the term mark.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap items-center gap-2"><SheetBadge status={status} /><span className="text-sm text-muted">Teacher: {g.teacherName}</span></div>
        <div className="flex flex-wrap gap-2">
          {review.mayVerify && flags.verify && <><Button onClick={() => void act('verify')} loading={busy}>Verify and lock</Button><Button variant="secondary" onClick={() => setModal('return')}>Return with a comment</Button></>}
          {flags.unlock && status === 'VERIFIED' && <Button variant="danger" onClick={() => setModal('unlock')}>Unlock for correction</Button>}
        </div>
      </div>

      {status === 'SUBMITTED' && !review.mayVerify && (
        <Notice tone="info">
          {review.verifier.hodIsTeacher
            ? `The Head of Department teaches this class, so it goes to the alternate verifier${review.verifier.names.filter(Boolean).length ? `: ${review.verifier.names.filter(Boolean).join(', ')}` : '. None is set yet: ask the Exams Officer to set one under Assessment setup'}.`
            : `Waiting for ${review.verifier.names.filter(Boolean).join(', ') || 'the Head of Department'} to verify.`}
        </Notice>
      )}
      {g.planProblem && <Notice tone="warn">{g.planProblem}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="This class" hint="Term marks as they stand now">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Students</dt><dd className="text-lg font-semibold text-ink">{review.stats.count}</dd></div>
            <div><dt className="text-muted">Mean</dt><dd className="text-lg font-semibold text-ink">{review.stats.mean ?? '-'}</dd></div>
            <div><dt className="text-muted">Highest / lowest</dt><dd className="text-lg font-semibold text-ink">{review.stats.highest ?? '-'} / {review.stats.lowest ?? '-'}</dd></div>
            <div><dt className="text-muted">Pass rate</dt><dd className="text-lg font-semibold text-ink">{review.stats.passRate === null ? '-' : `${Math.round(review.stats.passRate)}%`}</dd></div>
          </dl>
          <h3 className="mt-4 text-sm font-semibold text-ink">Grade spread</h3>
          <ul className="mt-2 flex flex-col gap-1.5" aria-label="Grade spread">
            {review.gradeSpread.map((s) => (
              <li key={s.grade} className="flex items-center gap-2 text-sm">
                <span className="w-6 font-semibold text-ink">{s.grade}</span>
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${(s.count / maxSpread) * 100}%` }} /></span>
                <span className="w-6 text-right tabular-nums text-muted">{s.count}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Other classes of this subject" hint="Same subject, same form, this term">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead><tr><Th>Class</Th><Th>Teacher</Th><Th className="text-right">Mean</Th><Th className="text-right">Pass rate</Th><Th className="text-right">vs form</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {review.siblings.map((s) => (
                  <tr key={s.assignmentId} className={s.current ? 'bg-tint' : undefined}>
                    <Td className="font-medium">{s.className}{s.current && <span className="ml-1 text-xs text-primary">(this one)</span>}</Td>
                    <Td>{s.teacher}</Td>
                    <Td className="text-right tabular-nums">{s.mean ?? '-'}</Td>
                    <Td className="text-right tabular-nums">{s.passRate === null ? '-' : `${Math.round(s.passRate)}%`}</Td>
                    <Td className={`text-right tabular-nums ${s.differenceFromForm !== null && s.differenceFromForm < -5 ? 'text-danger' : s.differenceFromForm !== null && s.differenceFromForm > 5 ? 'text-success' : ''}`}>{s.differenceFromForm === null ? '-' : `${s.differenceFromForm > 0 ? '+' : ''}${s.differenceFromForm}`}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {review.flagged.length > 0 && (
        <Section title="Marks to check" hint="More than the usual spread from the class mean">
          <ul className="flex flex-col gap-1 text-sm text-ink">{review.flagged.map((f, i) => <li key={i}><strong>{f.student}</strong>, {f.assessment}: {f.value}. <span className="text-muted">{f.message}</span></li>)}</ul>
        </Section>
      )}

      <Section title="The marks">
        <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: '60vh' }}>
          <table className="min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-[200px] border-b border-line bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Student</th>
                {g.columns.map((c) => <th key={c.key} className="sticky top-0 z-10 min-w-[80px] border-b border-line bg-white px-2 py-2 text-center text-xs font-semibold text-ink" title={c.stageName ? `${c.title}: ${c.stageName}` : c.title}><div className="max-w-[110px] truncate">{c.stageName ?? c.title}</div><div className="font-normal text-muted">/{c.max}</div></th>)}
                <th className="sticky top-0 z-10 border-b border-l border-line bg-tint px-2 py-2 text-xs font-semibold text-ink">Term</th>
                <th className="sticky top-0 z-10 border-b border-line bg-tint px-2 py-2 text-xs font-semibold text-ink">Grade</th>
              </tr>
            </thead>
            <tbody>
              {g.students.map((s) => {
                const p = g.preview[s.id];
                return (
                  <tr key={s.id}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-line bg-white px-3 py-1.5 text-left font-medium text-ink">{s.name}</th>
                    {g.columns.map((c) => {
                      const k = markKey(s.id, c.assessmentId, c.stageId);
                      const m = g.marks[k];
                      const flagged = !!g.warnings[k];
                      const text = m ? (m.v !== null ? String(m.v) : m.c === 'AB_EXCUSED' ? 'AB*' : m.c ?? '') : '';
                      return (
                        <td key={c.key} className={`border-b border-line px-2 py-1.5 text-center tabular-nums ${flagged ? 'bg-warn-bg font-semibold text-warn' : ''} ${!text ? 'text-danger' : ''}`} title={flagged ? g.warnings[k] : undefined}>
                          {text || '-'}
                          {flags.unlock && m?.c === 'AB' && status !== 'PUBLISHED' && <button type="button" className="ml-1 text-[10px] font-semibold text-primary underline" onClick={() => void excuse(s.id, c.assessmentId, c.stageId)} aria-label={`Excuse the absence of ${s.name}`}>excuse</button>}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-line bg-tint px-2 py-1.5 text-center font-semibold tabular-nums">{p?.roundedMark ?? '-'}</td>
                    <td className="border-b border-line bg-tint px-2 py-1.5 text-center font-semibold">{p?.grade ?? '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">AB* is an absence the Head excused: it is left out of the term mark. A dash in red is a mark that has not been entered.</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Who did what">
          {review.events.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
            <ol className="flex flex-col gap-2 text-sm">
              {review.events.map((e, i) => (
                <li key={i} className="rounded-xl border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="neutral" label={ACTION_TEXT[e.action] ?? e.action} /><span className="font-medium text-ink">{e.by}</span><span className="text-muted">{e.at.slice(0, 16).replace('T', ' ')}</span></div>
                  {e.comment && <p className="mt-1 text-ink">{e.comment}</p>}
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title="Mark history" hint="Every change after the sheet was first submitted: old value, new value, who, when and why">
          {review.history.length === 0 ? <p className="text-sm text-muted">No marks have been changed since the sheet was first submitted.</p> : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[480px] text-left">
                <thead><tr><Th>When</Th><Th>Student</Th><Th>Assessment</Th><Th>Change</Th><Th>By</Th><Th>Why</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {review.history.map((h, i) => (
                    <tr key={i}><Td className="whitespace-nowrap">{h.at.slice(0, 16).replace('T', ' ')}</Td><Td>{h.student}</Td><Td>{h.assessment}</Td><Td className="whitespace-nowrap">{h.from} → <strong>{h.to}</strong></Td><Td>{h.by}</Td><Td>{h.reason}</Td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      <Modal open={modal === 'return'} onClose={() => setModal(null)} title="Return to the teacher"
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button onClick={() => void act('return', { comment: text })} loading={busy} disabled={text.trim().length < 3}>Return</Button></>}>
        <div className="flex flex-col gap-1.5"><label htmlFor="rv-comment" className={labelClass}>What does the teacher need to fix? (required)</label>
          <textarea id="rv-comment" className={`${fieldClass} h-28 py-2`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /></div>
      </Modal>
      <Modal open={modal === 'unlock'} onClose={() => setModal(null)} title="Unlock for correction"
        footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button variant="danger" onClick={() => void act('unlock', { reason: text })} loading={busy} disabled={text.trim().length < 5}>Unlock</Button></>}>
        <p className="mb-3 text-sm text-ink">The sheet goes back to the teacher, who corrects it and submits it again for verification. Every change is kept in the mark history. If results have been published, unpublish the class first.</p>
        <div className="flex flex-col gap-1.5"><label htmlFor="ul-reason" className={labelClass}>Reason (required)</label>
          <textarea id="ul-reason" className={`${fieldClass} h-24 py-2`} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} /></div>
      </Modal>
    </div>
  );
}
