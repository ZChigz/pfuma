'use client';

// The syllabus: a tree of topics and sub-topics with learning objectives for a subject at a form. Entered here by the HOD, or
// imported from a CSV file (subject, level, topic, sub-topic, objectives), or started from a template another school shared.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, Notice, problem, Section } from '@/components/academics/shared';

interface Node { id: string; title: string; objectives: string | null; order: number; parentId: string | null; children: Node[] }
interface Template { id: string; name: string; subjectName: string; levelOrder: number; sharedBy: string; topics: number }

export function SyllabusClient({ index, selection, tree, templates, canManage }: {
  index: { levels: { id: string; name: string; order: number }[]; subjects: { id: string; name: string; levels: { levelId: string; topics: number }[] }[] };
  selection: { subjectId: string | null; levelId: string | null }; tree: { topics: Node[]; count: number } | null; templates: Template[]; canManage: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<{ id: string | null; parentId: string | null; title: string; objectives: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [report, setReport] = useState<{ created: number; updated: number; errors: { row: number; message: string }[] } | null>(null);
  const { subjectId, levelId } = selection;
  const subject = index.subjects.find((s) => s.id === subjectId);
  const offered = index.levels.filter((l) => subject?.levels.some((x) => x.levelId === l.id));
  const go = (s: string | null, l: string | null) => router.push(s ? `?subjectId=${s}${l ? `&levelId=${l}` : ''}` : '?');

  async function save() {
    if (!edit || !subjectId || !levelId) return;
    setBusy(true);
    const r = await api(edit.id ? `/api/academics/syllabus/${edit.id}` : '/api/academics/syllabus', edit.id ? 'PATCH' : 'POST', { subjectId, levelId, parentId: edit.parentId, title: edit.title, objectives: edit.objectives || null });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setEdit(null);
    router.refresh();
  }
  async function remove(n: Node) {
    if (!confirm(`Delete "${n.title}"?`)) return;
    const r = await api(`/api/academics/syllabus/${n.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    router.refresh();
  }
  async function runImport() {
    if (!csv) return;
    setBusy(true);
    const r = await api('/api/academics/syllabus/import', 'POST', { csv });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setReport(r.body.data);
    if (!r.body.data.errors.length) { toast.success(`${r.body.data.created} topics added, ${r.body.data.updated} updated`); router.refresh(); }
  }
  async function share() {
    if (!subjectId || !levelId) return;
    const r = await api('/api/academics/syllabus/share', 'POST', { subjectId, levelId });
    if (!r.ok) return toast.error(problem(r));
    toast.success('Shared. Other Pfuma schools can start from it.');
  }
  async function applyTemplate(t: Template) {
    if (!subjectId || !levelId || !confirm(`Fill this syllabus with "${t.name}" from ${t.sharedBy}?`)) return;
    const r = await api('/api/academics/syllabus/templates', 'POST', { templateId: t.id, subjectId, levelId });
    if (!r.ok) return toast.error(problem(r));
    toast.success(`${r.body.data.topics} topics added`);
    router.refresh();
  }

  const render = (nodes: Node[], depth = 0): React.ReactNode => (
    <ul className={depth ? 'ml-5 border-l border-line pl-3' : ''}>
      {nodes.map((n) => (
        <li key={n.id} className="py-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className={depth === 0 ? 'font-semibold text-ink' : 'text-ink'}>{n.title}</p>{n.objectives && <p className="text-sm text-muted">{n.objectives}</p>}</div>
            {canManage && (
              <div className="flex flex-shrink-0 gap-3 text-sm">
                <button type="button" onClick={() => setEdit({ id: null, parentId: n.id, title: '', objectives: '' })} className="font-semibold text-primary hover:underline">Add sub-topic</button>
                <button type="button" onClick={() => setEdit({ id: n.id, parentId: n.parentId, title: n.title, objectives: n.objectives ?? '' })} className="font-semibold text-primary hover:underline">Edit</button>
                <button type="button" onClick={() => remove(n)} className="font-semibold text-danger hover:underline">Delete</button>
              </div>
            )}
          </div>
          {n.children.length > 0 && render(n.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]"><Select id="sy-subject" label="Subject" value={subjectId ?? ''} onChange={(e) => go(e.target.value || null, null)} placeholder="Choose a subject" options={index.subjects.map((s) => ({ value: s.id, label: s.name }))} /></div>
        <div className="min-w-[160px]"><Select id="sy-level" label="Form" value={levelId ?? ''} onChange={(e) => go(subjectId, e.target.value || null)} placeholder="Choose a form" disabled={!subjectId} options={offered.map((l) => ({ value: l.id, label: `${l.name} (${subject?.levels.find((x) => x.levelId === l.id)?.topics ?? 0})` }))} /></div>
        {canManage && <Button variant="secondary" onClick={() => { setCsv(''); setReport(null); }}>Import from CSV</Button>}
      </div>

      {!tree && <p className="rounded-2xl bg-white p-8 text-center text-sm text-muted">Choose a subject and a form to see its syllabus.</p>}
      {tree && (
        <Section
          title={`${subject?.name} · ${index.levels.find((l) => l.id === levelId)?.name}`} hint={`${tree.count} topic${tree.count === 1 ? '' : 's'}`}
          action={canManage && <div className="flex flex-wrap gap-2"><Button onClick={() => setEdit({ id: null, parentId: null, title: '', objectives: '' })}>Add topic</Button>{tree.count > 0 && <Button variant="secondary" onClick={share}>Share as a template</Button>}</div>}
        >
          {tree.count === 0 ? (
            <div className="flex flex-col gap-3 py-4">
              <p className="text-sm text-muted">No topics yet.{canManage ? ' Add them one by one, import a CSV file, or start from a template another school shared.' : ''}</p>
              {canManage && templates.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line">{templates.map((t) => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><b>{t.name}</b> · {t.topics} topics · shared by {t.sharedBy}</span><button type="button" onClick={() => applyTemplate(t)} className="font-semibold text-primary hover:underline">Use this</button></li>)}</ul>
              )}
            </div>
          ) : render(tree.topics)}
        </Section>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit topic' : edit?.parentId ? 'Add sub-topic' : 'Add topic'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!edit?.title.trim()}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <Input id="t-title" label="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="For example Simultaneous equations" />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Learning objectives<textarea rows={3} value={edit.objectives} onChange={(e) => setEdit({ ...edit, objectives: e.target.value })} className="rounded-xl border border-line px-3 py-2 text-sm font-normal" /></label>
          </div>
        )}
      </Modal>

      <Modal open={csv !== null} onClose={() => setCsv(null)} size="lg" title="Import topics from CSV" footer={<><Button variant="secondary" onClick={() => setCsv(null)}>Close</Button><Button onClick={runImport} loading={busy} disabled={!csv}>Import</Button></>}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">Columns: <b>subject, level, topic, sub-topic, objectives</b>. The subject is its name or school code; the level is like &quot;Form 2&quot; or 2. If any row is wrong, nothing is imported.</p>
          <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setReport(null); } }} />
          <textarea rows={6} value={csv ?? ''} onChange={(e) => setCsv(e.target.value)} placeholder={'subject,level,topic,sub-topic,objectives\nMathematics,Form 2,Algebra,Simultaneous equations,Solve two equations'} className="rounded-xl border border-line px-3 py-2 font-mono text-xs" />
          {report && report.errors.length > 0 && <Notice tone="danger"><p className="mb-1 font-semibold">Nothing was imported. Fix these rows:</p><ul className="list-disc pl-5">{report.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul></Notice>}
        </div>
      </Modal>
    </div>
  );
}
