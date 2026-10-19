'use client';

// A teacher's assessments for one class: the list (their own and the papers set for every class), a form to add a test, assignment
// or practical, starting a school-based project from a template, and copying an assessment whose maximum mark was wrong.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Notice, Section, Td, Th, api, fieldClass, labelClass, problem } from '@/components/exams/shared';
import type { AssessmentView } from '@/lib/exams/assessments';

interface TypeOpt { id: string; name: string; isProject: boolean; commonExam: boolean; inPlan: boolean }
interface TemplateOpt { id: string; title: string; total: number; stages: number; dueDate: string | null }

export function AssessmentsClient({ assignmentId, assessments, types, plan, templates, topics, canCreate }: {
  assignmentId: string; assessments: AssessmentView[]; types: TypeOpt[]; plan: { label: string; weight: number }[] | null;
  templates: TemplateOpt[]; topics: { id: string; title: string }[]; canCreate: boolean;
}) {
  const router = useRouter();
  const usable = types.filter((t) => !t.isProject && !t.commonExam);
  const [typeId, setTypeId] = useState(usable[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [max, setMax] = useState('');
  const [counts, setCounts] = useState(true);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<AssessmentView | null>(null);
  const [copy, setCopy] = useState<AssessmentView | null>(null);
  const [copyMax, setCopyMax] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const picked = types.find((t) => t.id === typeId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await api('/api/exams/assessments', 'POST', { assignmentId, typeId, title, date: date || null, maxMark: Number(max), countsToTerm: counts, topicIds });
    setBusy(false);
    if (!r.ok) {
      const f = r.body.errors ?? {};
      setErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[0] ?? ''])));
      return toast.error(problem(r));
    }
    setErrors({});
    toast.success('Assessment added');
    setTitle(''); setDate(''); setMax(''); setTopicIds([]);
    router.refresh();
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    const r = await api(`/api/exams/assessments/${edit.id}`, 'PATCH', { title: edit.title, date: edit.date, countsToTerm: edit.countsToTerm, topicIds: edit.topicIds, ...(edit.hasMarks ? {} : { maxMark: edit.maxMark }) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Saved');
    setEdit(null);
    router.refresh();
  }

  async function doCopy() {
    if (!copy) return;
    setBusy(true);
    const r = await api(`/api/exams/assessments/${copy.id}/copy`, 'POST', { maxMark: Number(copyMax), replace: true });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Copied. Enter the marks again in the new assessment.');
    setCopy(null);
    router.refresh();
  }

  async function remove(a: AssessmentView) {
    if (!window.confirm(`Remove "${a.title}"? It has no marks.`)) return;
    const r = await api(`/api/exams/assessments/${a.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    toast.success('Removed');
    router.refresh();
  }

  async function startProject(templateId: string) {
    setBusy(true);
    const r = await api('/api/exams/projects/start', 'POST', { templateId, assignmentId });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Project started. Enter its marks stage by stage in the grid.');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {!plan && <Notice tone="warn">No weighting plan has been set for this level this term, so the term mark cannot be calculated yet. The Exams Officer sets it under Assessment setup.</Notice>}
      {plan && (
        <Section title="What counts towards the term mark" hint="Set for the whole level by the Exams Officer or the Head.">
          <ul className="flex flex-wrap gap-2 text-sm">
            {plan.map((l) => <li key={l.label} className="rounded-full bg-tint px-3 py-1 font-medium text-ink">{l.label} <strong>{l.weight}%</strong></li>)}
          </ul>
        </Section>
      )}

      <Section title="Assessments">
        {assessments.length === 0 ? <p className="text-sm text-muted">No assessments yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead><tr><Th>Title</Th><Th>Type</Th><Th>Date</Th><Th className="text-right">Out of</Th><Th>Counts</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody className="divide-y divide-line">
                {assessments.map((a) => (
                  <tr key={a.id}>
                    <Td><span className="font-medium">{a.title}</span>{a.common && <Badge className="ml-2" variant="info" label="All classes" />}{a.isProject && <Badge className="ml-2" variant="gold" label="Project" />}</Td>
                    <Td>{a.typeName}{types.find((t) => t.id === a.typeId) && !types.find((t) => t.id === a.typeId)!.inPlan && plan ? <span className="ml-1 text-xs text-warn" title="This type is not in the term's weighting plan, so it does not count">(not in plan)</span> : null}</Td>
                    <Td>{a.date ?? '-'}</Td>
                    <Td className="text-right tabular-nums">{a.maxMark}</Td>
                    <Td>{a.countsToTerm ? 'Yes' : 'No'}</Td>
                    <Td className="text-right">
                      {canCreate && !a.isProject && (!a.common) && (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEdit(a)}>Change</Button>
                          {a.hasMarks && <Button size="sm" variant="ghost" onClick={() => { setCopy(a); setCopyMax(String(a.maxMark)); }}>Copy</Button>}
                          {!a.hasMarks && <Button size="sm" variant="ghost" onClick={() => remove(a)}>Remove</Button>}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {canCreate && (
        <Section title="Add a test, assignment or practical" hint="End-of-term exams and mock exams are set once by the Exams Officer for every class.">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5"><label htmlFor="a-type" className={labelClass}>Type</label>
              <select id="a-type" className={fieldClass} value={typeId} onChange={(e) => setTypeId(e.target.value)}>{usable.map((t) => <option key={t.id} value={t.id}>{t.name}{plan && !t.inPlan ? ' (not in plan)' : ''}</option>)}</select></div>
            <div className="flex flex-col gap-1.5 sm:col-span-1 lg:col-span-1"><label htmlFor="a-title" className={labelClass}>Title</label>
              <input id="a-title" className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Algebra test 2" required maxLength={120} aria-invalid={errors.title ? true : undefined} />
              {errors.title && <span className="text-xs text-danger">{errors.title}</span>}</div>
            <div className="flex flex-col gap-1.5"><label htmlFor="a-date" className={labelClass}>Date</label>
              <input id="a-date" type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="a-max" className={labelClass}>Maximum mark</label>
              <input id="a-max" className={fieldClass} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="50" required aria-invalid={errors.maxMark ? true : undefined} />
              {errors.maxMark && <span className="text-xs text-danger">{errors.maxMark}</span>}</div>
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} className="h-4 w-4" /> Counts towards the term mark</label>
            {topics.length > 0 && (
              <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4"><label htmlFor="a-topics" className={labelClass}>Syllabus topics (optional)</label>
                <select id="a-topics" multiple className={`${fieldClass} h-28 py-2`} value={topicIds} onChange={(e) => setTopicIds(Array.from(e.target.selectedOptions, (o) => o.value))}>{topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
            )}
            {picked && plan && !picked.inPlan && <div className="sm:col-span-2 lg:col-span-4"><Notice tone="warn">{picked.name} is not in the term&apos;s weighting plan, so it will not count towards the term mark.</Notice></div>}
            <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={busy} disabled={!typeId}>Add assessment</Button></div>
          </form>
        </Section>
      )}

      {canCreate && templates.length > 0 && (
        <Section title="Start a school-based project" hint="Projects are marked stage by stage (or with a rubric). Their total counts like any other assessment.">
          <ul className="flex flex-col gap-2">
            {templates.map((t) => {
              const started = assessments.some((a) => a.projectId === t.id);
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-4 py-3">
                  <div><div className="font-medium text-ink">{t.title}</div><div className="text-sm text-muted">{t.stages} stage{t.stages === 1 ? '' : 's'}, {t.total} marks{t.dueDate ? `, due ${t.dueDate}` : ''}</div></div>
                  {started ? <Badge variant="success" label="Started" /> : <Button size="sm" variant="secondary" onClick={() => startProject(t.id)} loading={busy}>Start for this class</Button>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Change assessment" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveEdit} loading={busy}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5"><label htmlFor="e-title" className={labelClass}>Title</label><input id="e-title" className={fieldClass} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="e-date" className={labelClass}>Date</label><input id="e-date" type="date" className={fieldClass} value={edit.date ?? ''} onChange={(e) => setEdit({ ...edit, date: e.target.value || null })} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="e-max" className={labelClass}>Maximum mark</label>
              <input id="e-max" className={fieldClass} inputMode="decimal" disabled={edit.hasMarks} value={edit.maxMark} onChange={(e) => setEdit({ ...edit, maxMark: Number(e.target.value) })} />
              {edit.hasMarks && <span className="text-xs text-muted">Marks have been entered, so the maximum cannot change. Use Copy instead.</span>}</div>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={edit.countsToTerm} onChange={(e) => setEdit({ ...edit, countsToTerm: e.target.checked })} className="h-4 w-4" /> Counts towards the term mark</label>
          </div>
        )}
      </Modal>

      <Modal open={!!copy} onClose={() => setCopy(null)} title="Copy with a new maximum mark" footer={<><Button variant="ghost" onClick={() => setCopy(null)}>Cancel</Button><Button onClick={doCopy} loading={busy}>Copy</Button></>}>
        {copy && (
          <div className="flex flex-col gap-3 text-sm text-ink">
            <p>Marks have been entered for <strong>{copy.title}</strong>, so its maximum mark is fixed. A copy starts empty, with the maximum you choose. The original stops counting towards the term mark, and you enter the marks again in the copy.</p>
            <div className="flex flex-col gap-1.5"><label htmlFor="c-max" className={labelClass}>New maximum mark</label><input id="c-max" className={fieldClass} inputMode="decimal" value={copyMax} onChange={(e) => setCopyMax(e.target.value)} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
