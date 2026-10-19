'use client';

// The per-student rubric view of a school-based project stage: click a level for each criterion, the total is calculated, and
// photos or files of the work are attached as evidence so moderation can see them.
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useUploadThing } from '@/lib/uploadthing';
import { Notice, Section, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { RubricView } from '@/lib/exams/projects';

export function RubricClient({ assignmentId, assessmentId, stageId, rubric, canEdit, needsReason, students, stages }: {
  assignmentId: string; assessmentId: string; stageId: string; rubric: RubricView; canEdit: boolean; needsReason: boolean;
  students: { id: string; name: string }[]; stages: { assessmentId: string; stageId: string; label: string }[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Record<string, string | null>>(Object.fromEntries(rubric.criteria.map((c) => [c.id, c.chosenLevelId])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { startUpload } = useUploadThing('projectEvidence');

  const total = rubric.criteria.reduce((sum, c) => sum + (c.levels.find((l) => l.id === chosen[c.id])?.marks ?? 0), 0);
  const done = rubric.criteria.filter((c) => chosen[c.id]).length;
  const idx = students.findIndex((s) => s.id === rubric.student.id);
  const href = (studentId: string, st = { assessmentId, stageId }) => `/exams/marks/${assignmentId}/rubric?assessmentId=${st.assessmentId}&stageId=${st.stageId}&studentId=${studentId}`;

  async function choose(criterionId: string, levelId: string) {
    if (!canEdit) return;
    if (needsReason && reason.trim().length < 3) return toast.error('Give a reason first: this sheet was submitted before, so changes are kept in the mark history.');
    const previous = chosen[criterionId] ?? null;
    setChosen((c) => ({ ...c, [criterionId]: levelId }));
    setBusy(true);
    const scores = Object.entries({ ...chosen, [criterionId]: levelId }).filter(([, l]) => l).map(([cid, l]) => ({ criterionId: cid, levelId: l as string }));
    const r = await api('/api/exams/rubric', 'PUT', { assignmentId, assessmentId, stageId, studentId: rubric.student.id, scores, reason: reason.trim() || null });
    setBusy(false);
    if (!r.ok) {
      setChosen((c) => ({ ...c, [criterionId]: previous }));
      return toast.error(problem(r));
    }
    router.refresh();
  }

  async function onFile(file: File) {
    setUploading(true);
    try {
      const res = await startUpload([file]);
      const key = (res?.[0]?.serverData as { key?: string } | undefined)?.key;
      if (!key) throw new Error('The upload did not finish');
      const r = await api('/api/exams/evidence', 'POST', { assignmentId, assessmentId, studentId: rubric.student.id, stageId, fileKey: key, fileName: file.name, contentType: file.type });
      if (!r.ok) throw new Error(problem(r));
      toast.success('Evidence added');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function open(id: string) {
    const r = await api(`/api/exams/evidence/${id}/link`);
    if (!r.ok) return toast.error(problem(r));
    window.open((r.body.data as { url: string }).url, '_blank', 'noopener');
  }

  return (
    <div className="flex flex-col gap-4">
      {!canEdit && <Notice tone="warn">This mark sheet is locked, so the rubric can be looked at but not changed.</Notice>}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5"><label htmlFor="rb-student" className={labelClass}>Student</label>
          <select id="rb-student" className={fieldClass} value={rubric.student.id} onChange={(e) => router.push(href(e.target.value))}>{students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        {stages.length > 1 && (
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5"><label htmlFor="rb-stage" className={labelClass}>Stage</label>
            <select id="rb-stage" className={fieldClass} value={`${assessmentId}|${stageId}`} onChange={(e) => { const [a, s] = e.target.value.split('|'); router.push(href(rubric.student.id, { assessmentId: a!, stageId: s! })); }}>
              {stages.map((s) => <option key={`${s.assessmentId}|${s.stageId}`} value={`${s.assessmentId}|${s.stageId}`}>{s.label}</option>)}</select></div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={idx <= 0} onClick={() => router.push(href(students[idx - 1]!.id))}>Previous</Button>
          <Button variant="secondary" disabled={idx >= students.length - 1} onClick={() => router.push(href(students[idx + 1]!.id))}>Next</Button>
        </div>
      </div>

      {needsReason && canEdit && (
        <div className="rounded-2xl border border-warn-line bg-warn-bg p-4">
          <label htmlFor="rb-reason" className="text-sm font-semibold text-warn">This sheet has been submitted before. Why are you changing marks?</label>
          <input id="rb-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none" />
        </div>
      )}

      <Section title={rubric.student.name} hint={`${rubric.stage.name}: ${done} of ${rubric.criteria.length} criteria marked`}
        action={<div className="text-right"><div className="text-2xl font-bold tabular-nums text-ink">{total}<span className="text-base font-medium text-muted"> / {rubric.stage.maxMark}</span></div>{done < rubric.criteria.length && <div className="text-xs text-warn">Not complete: the stage mark is saved when every criterion has a level</div>}</div>}>
        <div className="flex flex-col gap-4">
          {rubric.criteria.map((c) => (
            <fieldset key={c.id} className="rounded-xl border border-line p-3" disabled={!canEdit || busy}>
              <legend className="px-1 text-sm font-semibold text-ink">{c.name}</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {c.levels.map((l) => {
                  const on = chosen[c.id] === l.id;
                  return (
                    <button key={l.id} type="button" onClick={() => void choose(c.id, l.id)} aria-pressed={on}
                      className={cn('flex min-h-[64px] flex-col items-start rounded-xl border p-3 text-left transition-colors', on ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink hover:bg-tint')}>
                      <span className="text-sm font-semibold">{l.label} <span className={cn('font-normal', on ? 'text-white/80' : 'text-muted')}>({l.marks})</span></span>
                      {l.descriptor && <span className={cn('mt-1 text-xs', on ? 'text-white/90' : 'text-muted')}>{l.descriptor}</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </Section>

      <Section title="Evidence" hint="Photos of the work or a file, kept for moderation.">
        {rubric.evidence.length === 0 ? <p className="text-sm text-muted">Nothing attached yet.</p> : (
          <ul className="mb-3 flex flex-col gap-2">
            {rubric.evidence.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-sm">
                <span className="truncate">{e.fileName ?? 'File'} <span className="text-muted">· {e.at.slice(0, 10)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => void open(e.id)}>Open</Button>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" aria-label="Choose a photo or file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
            <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>Add a photo or file</Button>
          </>
        )}
      </Section>
    </div>
  );
}
