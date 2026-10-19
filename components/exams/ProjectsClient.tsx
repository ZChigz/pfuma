'use client';

// School-based project templates: title, subject, form, start and due dates, the brief (an uploaded file) and the stages. A stage has
// a maximum mark, or a rubric: criteria, each with levels (a name, a descriptor and the marks for that level). A template can be copied
// for the next term or year. The stages and rubric can change only while no mark has been entered.
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { useUploadThing } from '@/lib/uploadthing';
import { Notice, Section, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { TemplateView } from '@/lib/exams/projects';

interface LevelDraft { label: string; descriptor: string; marks: string }
interface CriterionDraft { name: string; levels: LevelDraft[] }
interface StageDraft { name: string; maxMark: string; rubric: boolean; criteria: CriterionDraft[] }
interface Draft { id: string | null; title: string; subjectId: string; levelId: string; startDate: string; dueDate: string; briefFileKey: string | null; briefFileName: string | null; stages: StageDraft[]; locked: boolean }

const blankLevels = (): LevelDraft[] => [
  { label: 'Excellent', descriptor: '', marks: '4' }, { label: 'Good', descriptor: '', marks: '3' }, { label: 'Fair', descriptor: '', marks: '2' }, { label: 'Weak', descriptor: '', marks: '1' },
];
const blankStage = (): StageDraft => ({ name: '', maxMark: '', rubric: false, criteria: [] });

const fromView = (t: TemplateView): Draft => ({
  id: t.id, title: t.title, subjectId: t.subjectId, levelId: t.levelId, startDate: t.startDate ?? '', dueDate: t.dueDate ?? '', briefFileKey: t.briefFileKey, briefFileName: t.briefFileName, locked: t.inUse,
  stages: t.stages.map((s) => ({
    name: s.name, maxMark: String(s.maxMark), rubric: !!s.rubric,
    criteria: s.rubric ? s.rubric.criteria.map((c) => ({ name: c.name, levels: c.levels.map((l) => ({ label: l.label, descriptor: l.descriptor ?? '', marks: String(l.marks) })) })) : [],
  })),
});

export function ProjectsClient({ templates, subjects, levels, canManage }: { templates: TemplateView[]; subjects: { id: string; name: string }[]; levels: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { startUpload } = useUploadThing('projectBrief');

  const blank = (): Draft => ({ id: null, title: '', subjectId: subjects[0]?.id ?? '', levelId: levels[0]?.id ?? '', startDate: '', dueDate: '', briefFileKey: null, briefFileName: null, stages: [{ ...blankStage(), name: 'Proposal' }], locked: false });
  const setStage = (i: number, patch: Partial<StageDraft>) => setDraft((d) => d && { ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  function payload(d: Draft) {
    return {
      title: d.title, subjectId: d.subjectId, levelId: d.levelId, startDate: d.startDate || null, dueDate: d.dueDate || null, briefFileKey: d.briefFileKey, briefFileName: d.briefFileName,
      stages: d.stages.map((s) => (s.rubric
        ? { name: s.name, rubric: { criteria: s.criteria.map((c) => ({ name: c.name, levels: c.levels.map((l) => ({ label: l.label, descriptor: l.descriptor || null, marks: Number(l.marks) })) })) } }
        : { name: s.name, maxMark: Number(s.maxMark) })),
    };
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = payload(draft);
    const r = draft.id
      ? await api(`/api/exams/projects/${draft.id}`, 'PATCH', draft.locked ? { title: body.title, startDate: body.startDate, dueDate: body.dueDate, briefFileKey: body.briefFileKey, briefFileName: body.briefFileName } : body)
      : await api('/api/exams/projects', 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Project saved');
    setDraft(null);
    router.refresh();
  }

  async function copy(t: TemplateView) {
    const r = await api(`/api/exams/projects/${t.id}/copy`, 'POST', {});
    if (!r.ok) return toast.error(problem(r));
    toast.success('Copied. Change the dates and the title for the new term.');
    router.refresh();
  }

  async function onBrief(file: File) {
    setUploading(true);
    try {
      const res = await startUpload([file]);
      const key = (res?.[0]?.serverData as { key?: string } | undefined)?.key;
      if (!key) throw new Error('The upload did not finish');
      setDraft((d) => d && { ...d, briefFileKey: key, briefFileName: file.name });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function openBrief(id: string) {
    const r = await api(`/api/exams/projects/${id}/brief`);
    if (!r.ok) return toast.error(problem(r));
    window.open((r.body.data as { url: string }).url, '_blank', 'noopener');
  }

  const rubricTotal = (s: StageDraft) => s.criteria.reduce((a, c) => a + Math.max(0, ...c.levels.map((l) => Number(l.marks) || 0)), 0);

  return (
    <div className="flex flex-col gap-4">
      {canManage && <div><Button onClick={() => setDraft(blank())}>New project</Button></div>}
      {templates.length === 0 ? <Notice tone="info">No projects yet. {canManage ? 'Create one, then teachers can start it for their classes.' : 'The Exams Officer creates project templates.'}</Notice> : (
        <ul className="flex flex-col gap-3">
          {templates.map((t) => (
            <li key={t.id} className="rounded-2xl bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">{t.title}</h2>
                  <p className="text-sm text-muted">{t.subject} · {t.level} · {t.total} marks{t.startDate ? ` · starts ${t.startDate}` : ''}{t.dueDate ? ` · due ${t.dueDate}` : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {t.inUse && <Badge variant="info" label="In use" />}
                  {t.briefFileKey && <Button size="sm" variant="ghost" onClick={() => openBrief(t.id)}>Brief</Button>}
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setDraft(fromView(t))}>{t.inUse ? 'Change dates' : 'Change'}</Button>}
                  {canManage && <Button size="sm" variant="ghost" onClick={() => copy(t)}>Copy for next term</Button>}
                </div>
              </div>
              <ol className="mt-3 flex flex-wrap gap-2 text-sm">
                {t.stages.map((s) => <li key={s.id} className="rounded-full bg-tint px-3 py-1 text-ink">{s.name} <strong>{s.maxMark}</strong>{s.rubric ? ' · rubric' : ''}</li>)}
              </ol>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} size="xl" title={draft?.id ? 'Change project' : 'New project'}
        footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save project</Button></>}>
        {draft && (
          <div className="flex flex-col gap-4">
            {draft.locked && <Notice tone="warn">Marks have been entered, so only the title, dates and brief can change. Copy the project to change its stages.</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2"><label htmlFor="pj-title" className={labelClass}>Title</label><input id="pj-title" className={fieldClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120} /></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="pj-subject" className={labelClass}>Subject</label><select id="pj-subject" className={fieldClass} disabled={!!draft.id} value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="pj-level" className={labelClass}>Form</label><select id="pj-level" className={fieldClass} disabled={!!draft.id} value={draft.levelId} onChange={(e) => setDraft({ ...draft, levelId: e.target.value })}>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="pj-start" className={labelClass}>Start date</label><input id="pj-start" type="date" className={fieldClass} value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></div>
              <div className="flex flex-col gap-1.5"><label htmlFor="pj-due" className={labelClass}>Due date</label><input id="pj-due" type="date" className={fieldClass} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label="Choose the project brief" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBrief(f); e.target.value = ''; }} />
                <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>{draft.briefFileKey ? 'Replace the brief' : 'Upload the brief'}</Button>
                {draft.briefFileName && <span className="truncate text-sm text-muted">{draft.briefFileName}</span>}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-ink">Stages</h3>
              {draft.stages.map((s, i) => (
                <div key={i} className="rounded-xl border border-line p-3">
                  <div className="grid gap-3 sm:grid-cols-12">
                    <div className="flex flex-col gap-1.5 sm:col-span-5"><label htmlFor={`st-n-${i}`} className={labelClass}>Stage name</label><input id={`st-n-${i}`} className={fieldClass} disabled={draft.locked} value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} placeholder="Proposal, Research, Practical work, Final report" /></div>
                    <div className="flex flex-col gap-1.5 sm:col-span-3"><label htmlFor={`st-m-${i}`} className={labelClass}>Maximum mark</label>
                      {s.rubric ? <input id={`st-m-${i}`} className={fieldClass} disabled value={rubricTotal(s)} readOnly aria-describedby={`st-h-${i}`} /> : <input id={`st-m-${i}`} className={fieldClass} inputMode="decimal" disabled={draft.locked} value={s.maxMark} onChange={(e) => setStage(i, { maxMark: e.target.value })} />}
                      {s.rubric && <span id={`st-h-${i}`} className="text-xs text-muted">Worked out from the rubric</span>}</div>
                    <label className="flex items-end gap-2 pb-3 text-sm text-ink sm:col-span-3"><input type="checkbox" className="h-4 w-4" disabled={draft.locked} checked={s.rubric} onChange={(e) => setStage(i, { rubric: e.target.checked, criteria: e.target.checked && s.criteria.length === 0 ? [{ name: '', levels: blankLevels() }] : s.criteria })} /> Mark with a rubric</label>
                    {!draft.locked && draft.stages.length > 1 && <div className="flex items-end sm:col-span-1"><Button size="sm" variant="ghost" aria-label={`Remove stage ${i + 1}`} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, j) => j !== i) })}>×</Button></div>}
                  </div>
                  {s.rubric && (
                    <div className="mt-3 flex flex-col gap-3">
                      {s.criteria.map((c, ci) => (
                        <div key={ci} className="rounded-lg bg-canvas p-3">
                          <div className="flex items-end gap-2">
                            <div className="flex flex-1 flex-col gap-1.5"><label htmlFor={`cr-${i}-${ci}`} className={labelClass}>Criterion</label><input id={`cr-${i}-${ci}`} className={fieldClass} disabled={draft.locked} value={c.name} onChange={(e) => setStage(i, { criteria: s.criteria.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)) })} placeholder="Research, Method, Presentation" /></div>
                            {!draft.locked && <Button size="sm" variant="ghost" aria-label={`Remove criterion ${ci + 1}`} onClick={() => setStage(i, { criteria: s.criteria.filter((_, k) => k !== ci) })}>×</Button>}
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {c.levels.map((l, li) => (
                              <div key={li} className="rounded-lg bg-white p-2">
                                <input aria-label="Level name" className="h-9 w-full rounded border border-line px-2 text-sm" disabled={draft.locked} value={l.label} onChange={(e) => setStage(i, { criteria: s.criteria.map((x, k) => (k === ci ? { ...x, levels: x.levels.map((y, m) => (m === li ? { ...y, label: e.target.value } : y)) } : x)) })} />
                                <input aria-label="Marks for this level" inputMode="decimal" className="mt-1 h-9 w-full rounded border border-line px-2 text-sm" disabled={draft.locked} value={l.marks} onChange={(e) => setStage(i, { criteria: s.criteria.map((x, k) => (k === ci ? { ...x, levels: x.levels.map((y, m) => (m === li ? { ...y, marks: e.target.value } : y)) } : x)) })} />
                                <input aria-label="Describe this level" placeholder="What it looks like" className="mt-1 h-9 w-full rounded border border-line px-2 text-xs" disabled={draft.locked} value={l.descriptor} onChange={(e) => setStage(i, { criteria: s.criteria.map((x, k) => (k === ci ? { ...x, levels: x.levels.map((y, m) => (m === li ? { ...y, descriptor: e.target.value } : y)) } : x)) })} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!draft.locked && <div><Button size="sm" variant="secondary" onClick={() => setStage(i, { criteria: [...s.criteria, { name: '', levels: blankLevels() }] })}>Add a criterion</Button></div>}
                    </div>
                  )}
                </div>
              ))}
              {!draft.locked && <div><Button variant="secondary" onClick={() => setDraft({ ...draft, stages: [...draft.stages, blankStage()] })} disabled={draft.stages.length >= 10}>Add a stage</Button></div>}
            </div>
          </div>
        )}
      </Modal>
      <Section title="How a project is marked" hint="">
        <p className="text-sm text-muted">Teachers start the project from the Assessments page of their class. The grid then has a column for each stage; a stage marked with a rubric opens a per-student view where the teacher clicks a level for each criterion and attaches photos of the work as evidence for moderation. The project total counts in the term weighting plan under School-based project.</p>
      </Section>
    </div>
  );
}
