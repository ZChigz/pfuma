'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, Dot, Notice, problem, Section, Tabs, Td, Th } from '@/components/academics/shared';

interface Level { id: string; name: string; order: number }
interface SubjectRow {
  id: string; name: string; shortName: string; code: string; zimsecCode: string | null; cambridgeCode: string | null; departmentId: string | null; department: string | null;
  examBoard: 'ZIMSEC' | 'CAMBRIDGE' | 'SCHOOL'; isPractical: boolean; colour: string; active: boolean; levels: { levelId: string; type: 'CORE' | 'ELECTIVE' }[];
}
interface Department { id: string; name: string; hodUserId: string | null; hodName: string | null; subjects: number }
interface Combination { id: string; name: string; levelId: string; level: string; subjects: { id: string; name: string; shortName: string }[]; classes: { id: string; name: string }[] }
interface Change { id: string; kind: string; status: string; subjectId: string | null; payload: Record<string, unknown>; note: string | null; requestedBy: string; decidedBy: string | null; createdAt: string }
interface StarterRow { name: string; shortName: string; code: string; department: string; examBoard: string; isPractical: boolean; colour: string; levels: Record<string, 'CORE' | 'ELECTIVE'>; picked: boolean }

type Tab = 'subjects' | 'departments' | 'combinations' | 'approvals';
const BOARD: Record<string, string> = { ZIMSEC: 'ZIMSEC', CAMBRIDGE: 'Cambridge', SCHOOL: 'School only' };

export function SubjectsClient({ levels, subjects, departments, combinations, classes, changes, staff, flags, initialTab }: {
  levels: Level[]; subjects: SubjectRow[]; departments: Department[]; combinations: Combination[]; classes: { id: string; name: string; levelId: string }[]; changes: Change[];
  staff: { id: string; fullName: string }[]; flags: { manage: boolean; approve: boolean; offersCambridge: boolean }; initialTab?: Tab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'subjects');
  const pending = changes.filter((c) => c.status === 'PENDING');

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Subjects"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'subjects', label: 'Subjects', badge: subjects.length },
          { id: 'departments', label: 'Departments', badge: departments.length },
          { id: 'combinations', label: 'Combinations', badge: combinations.length },
          { id: 'approvals', label: 'Approvals', badge: pending.length },
        ]}
      />
      {tab === 'subjects' && <SubjectsTab {...{ levels, subjects, departments, flags, refresh: () => router.refresh() }} />}
      {tab === 'departments' && <DepartmentsTab {...{ departments, staff, flags, refresh: () => router.refresh() }} />}
      {tab === 'combinations' && <CombinationsTab {...{ levels, subjects, combinations, classes, flags, refresh: () => router.refresh() }} />}
      {tab === 'approvals' && <ApprovalsTab {...{ changes, flags, refresh: () => router.refresh() }} />}
    </div>
  );
}

// ─── Subjects ────────────────────────────────────────────────────────────────

type Draft = {
  id: string | null; name: string; shortName: string; code: string; zimsecCode: string; cambridgeCode: string; departmentId: string; examBoard: string; isPractical: boolean; colour: string; active: boolean;
  levels: Record<string, '' | 'CORE' | 'ELECTIVE'>;
};

const blank = (levels: Level[]): Draft => ({ id: null, name: '', shortName: '', code: '', zimsecCode: '', cambridgeCode: '', departmentId: '', examBoard: 'ZIMSEC', isPractical: false, colour: '#0F766E', active: true, levels: Object.fromEntries(levels.map((l) => [l.id, ''])) });

function SubjectsTab({ levels, subjects, departments, flags, refresh }: { levels: Level[]; subjects: SubjectRow[]; departments: Department[]; flags: { manage: boolean; approve: boolean; offersCambridge: boolean }; refresh: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [starter, setStarter] = useState<StarterRow[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const shown = subjects.filter((s) => showInactive || s.active);

  const grouped = useMemo(() => {
    const m = new Map<string, SubjectRow[]>();
    for (const s of shown) m.set(s.department ?? 'No department', [...(m.get(s.department ?? 'No department') ?? []), s]);
    return Array.from(m).sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);

  function edit(s: SubjectRow) {
    setDraft({
      id: s.id, name: s.name, shortName: s.shortName, code: s.code, zimsecCode: s.zimsecCode ?? '', cambridgeCode: s.cambridgeCode ?? '', departmentId: s.departmentId ?? '', examBoard: s.examBoard,
      isPractical: s.isPractical, colour: s.colour, active: s.active, levels: Object.fromEntries(levels.map((l) => [l.id, s.levels.find((x) => x.levelId === l.id)?.type ?? ''])),
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name, shortName: draft.shortName, code: draft.code, zimsecCode: draft.zimsecCode || null, cambridgeCode: draft.cambridgeCode || null, departmentId: draft.departmentId,
      examBoard: draft.examBoard, isPractical: draft.isPractical, colour: draft.colour, active: draft.active,
      levels: Object.entries(draft.levels).filter(([, t]) => t).map(([levelId, type]) => ({ levelId, type })),
    };
    const r = await api(draft.id ? `/api/academics/subjects/${draft.id}` : '/api/academics/subjects', draft.id ? 'PATCH' : 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(r.body.data?.applied ? 'Subject saved' : 'Sent for Head approval');
    setDraft(null);
    refresh();
  }

  async function setActive(s: SubjectRow, active: boolean) {
    const r = await api(`/api/academics/subjects/${s.id}/active`, 'POST', { active });
    if (!r.ok) return toast.error(problem(r));
    toast.success(r.body.data?.applied ? (active ? 'Subject is active again' : 'Subject made inactive') : 'Sent for Head approval');
    refresh();
  }

  async function openStarter() {
    const r = await api('/api/academics/subjects/starter');
    if (!r.ok) return toast.error(problem(r));
    const taken = new Set(subjects.map((s) => s.code));
    setStarter((r.body.data.subjects as Omit<StarterRow, 'picked'>[]).map((s) => ({ ...s, picked: !taken.has(s.code) })));
  }

  async function loadStarter() {
    if (!starter) return;
    setBusy(true);
    const r = await api('/api/academics/subjects/starter', 'POST', { subjects: starter.filter((s) => s.picked).map(({ picked, ...s }) => { void picked; return s; }) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data;
    toast.success(d.queued ? `${d.queued} subjects sent for approval` : `${d.created} subjects added${d.skipped ? `, ${d.skipped} already there` : ''}`);
    setStarter(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive subjects</label>
        {flags.manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={openStarter}>Start from the starter list</Button>
            <Button onClick={() => setDraft(blank(levels))} disabled={departments.length === 0} title={departments.length === 0 ? 'Add a department first' : undefined}>Add subject</Button>
          </div>
        )}
      </div>
      {departments.length === 0 && flags.manage && <Notice tone="info">Subjects are grouped into departments. Add a department first, or load the starter list, which makes them for you.</Notice>}

      {grouped.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-sm text-muted">No subjects yet.</p>}
      {grouped.map(([dept, list]) => (
        <Section key={dept} title={dept}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <caption className="sr-only">Subjects in {dept}</caption>
              <thead><tr><Th>Subject</Th><Th>Code</Th><Th>Board</Th><Th>Forms</Th><Th>Practical</Th><Th>{flags.manage && <span className="sr-only">Actions</span>}</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {list.map((s) => (
                  <tr key={s.id} className={s.active ? 'hover:bg-rowhover' : 'bg-canvas opacity-70'}>
                    <Td><span className="flex items-center gap-2 font-semibold"><Dot colour={s.colour} />{s.name}<span className="text-xs font-normal text-muted">({s.shortName})</span>{!s.active && <Badge label="Inactive" />}</span></Td>
                    <Td className="text-muted">{s.code}{s.zimsecCode ? ` · Z ${s.zimsecCode}` : ''}{s.cambridgeCode ? ` · C ${s.cambridgeCode}` : ''}</Td>
                    <Td>{BOARD[s.examBoard]}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {levels.map((l) => {
                          const t = s.levels.find((x) => x.levelId === l.id)?.type;
                          return t ? <span key={l.id} title={`${l.name}: ${t === 'CORE' ? 'core' : 'elective'}`} className={`rounded px-1.5 text-xs font-semibold ${t === 'CORE' ? 'bg-primary text-white' : 'bg-tint text-primary'}`}>{l.order}{t === 'CORE' ? 'C' : 'E'}</span> : null;
                        })}
                      </span>
                    </Td>
                    <Td>{s.isPractical ? 'Yes' : 'No'}</Td>
                    <Td className="text-right">
                      {flags.manage && (
                        <span className="flex justify-end gap-3">
                          <button type="button" onClick={() => edit(s)} className="text-sm font-semibold text-primary hover:underline">Edit</button>
                          <button type="button" onClick={() => setActive(s, !s.active)} className="text-sm font-semibold text-muted hover:underline">{s.active ? 'Make inactive' : 'Make active'}</button>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
      <p className="text-xs text-muted">Forms: 1C means core in Form 1 (every student takes it), 3E means an elective in Form 3 (chosen). Changes to this list go to the Head for approval.</p>

      <Modal
        open={!!draft} onClose={() => setDraft(null)} size="lg" title={draft?.id ? `Edit ${draft.name}` : 'Add a subject'}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={save} loading={busy}>{flags.approve ? 'Save' : 'Send for approval'}</Button></>}
      >
        {draft && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input id="s-name" label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            <Input id="s-short" label="Short name (timetable)" value={draft.shortName} onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} maxLength={14} hint="For example Maths, Comb Sci" required />
            <Input id="s-code" label="School code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} maxLength={12} required />
            <Select id="s-dept" label="Department" value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })} placeholder="Choose" options={departments.map((d) => ({ value: d.id, label: d.name }))} required />
            <Select id="s-board" label="Exam board" value={draft.examBoard} onChange={(e) => setDraft({ ...draft, examBoard: e.target.value })} options={[{ value: 'ZIMSEC', label: 'ZIMSEC' }, ...(flags.offersCambridge || draft.examBoard === 'CAMBRIDGE' ? [{ value: 'CAMBRIDGE', label: 'Cambridge' }] : []), { value: 'SCHOOL', label: 'School only' }]} />
            <label className="flex min-h-[44px] items-end gap-3 pb-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={draft.isPractical} onChange={(e) => setDraft({ ...draft, isPractical: e.target.checked })} />Practical (may need double periods and a lab)</label>
            <Input id="s-zim" label="ZIMSEC subject code (optional)" value={draft.zimsecCode} onChange={(e) => setDraft({ ...draft, zimsecCode: e.target.value })} />
            <Input id="s-cam" label="Cambridge subject code (optional)" value={draft.cambridgeCode} onChange={(e) => setDraft({ ...draft, cambridgeCode: e.target.value })} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="s-colour" className="text-sm font-medium text-ink">Colour on the timetable</label>
              <input id="s-colour" type="color" value={draft.colour} onChange={(e) => setDraft({ ...draft, colour: e.target.value.toUpperCase() })} className="h-11 w-24 rounded-xl border border-line bg-white p-1" />
            </div>
            <label className="flex min-h-[44px] items-end gap-3 pb-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active</label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-ink">Forms that offer it</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {levels.map((l) => (
                  <Select key={l.id} id={`lvl-${l.id}`} label={l.name} value={draft.levels[l.id] ?? ''} onChange={(e) => setDraft({ ...draft, levels: { ...draft.levels, [l.id]: e.target.value as Draft['levels'][string] } })}
                    options={[{ value: '', label: 'Not offered' }, { value: 'CORE', label: 'Core' }, { value: 'ELECTIVE', label: 'Elective' }]} />
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>

      <Modal
        open={!!starter} onClose={() => setStarter(null)} size="xl" title="Starter list of subjects"
        footer={<><Button variant="secondary" onClick={() => setStarter(null)}>Cancel</Button><Button onClick={loadStarter} loading={busy} disabled={!starter?.some((s) => s.picked)}>Add the ticked subjects</Button></>}
      >
        <p className="mb-3 text-sm text-muted">Common Zimbabwe secondary subjects. Untick what you do not teach and change any name, short name or code before adding. You can edit everything afterwards.</p>
        <div className="max-h-[55vh] overflow-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead><tr><Th>Add</Th><Th>Subject</Th><Th>Short</Th><Th>Code</Th><Th>Department</Th></tr></thead>
            <tbody className="divide-y divide-line">
              {starter?.map((s, i) => (
                <tr key={s.code + i}>
                  <Td><input type="checkbox" className="h-5 w-5" aria-label={`Add ${s.name}`} checked={s.picked} onChange={(e) => setStarter(starter.map((x, j) => (j === i ? { ...x, picked: e.target.checked } : x)))} /></Td>
                  <Td><input aria-label="Name" className="w-full rounded-lg border border-line px-2 py-1" value={s.name} onChange={(e) => setStarter(starter.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></Td>
                  <Td><input aria-label="Short name" className="w-24 rounded-lg border border-line px-2 py-1" maxLength={14} value={s.shortName} onChange={(e) => setStarter(starter.map((x, j) => (j === i ? { ...x, shortName: e.target.value } : x)))} /></Td>
                  <Td><input aria-label="Code" className="w-20 rounded-lg border border-line px-2 py-1" maxLength={12} value={s.code} onChange={(e) => setStarter(starter.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} /></Td>
                  <Td className="text-muted">{s.department}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

// ─── Departments ─────────────────────────────────────────────────────────────

function DepartmentsTab({ departments, staff, flags, refresh }: { departments: Department[]; staff: { id: string; fullName: string }[]; flags: { manage: boolean }; refresh: () => void }) {
  const [edit, setEdit] = useState<{ id: string | null; name: string; hodUserId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    const r = await api(edit.id ? `/api/academics/departments/${edit.id}` : '/api/academics/departments', edit.id ? 'PATCH' : 'POST', { name: edit.name, hodUserId: edit.hodUserId || null });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Department saved');
    setEdit(null);
    refresh();
  }
  async function remove(d: Department) {
    if (!confirm(`Delete ${d.name}?`)) return;
    const r = await api(`/api/academics/departments/${d.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    toast.success('Department deleted');
    refresh();
  }

  return (
    <Section title="Departments" hint="The head of department gets the HOD role for their department only." action={flags.manage && <Button onClick={() => setEdit({ id: null, name: '', hodUserId: '' })}>Add department</Button>}>
      <ul className="divide-y divide-line">
        {departments.length === 0 && <li className="py-6 text-center text-sm text-muted">No departments yet.</li>}
        {departments.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><p className="font-semibold text-ink">{d.name}</p><p className="text-sm text-muted">{d.subjects} subject{d.subjects === 1 ? '' : 's'} · Head: {d.hodName ?? 'not set'}</p></div>
            {flags.manage && (
              <div className="flex gap-3">
                <button type="button" onClick={() => setEdit({ id: d.id, name: d.name, hodUserId: d.hodUserId ?? '' })} className="text-sm font-semibold text-primary hover:underline">Edit</button>
                <button type="button" onClick={() => remove(d)} className="text-sm font-semibold text-danger hover:underline">Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit department' : 'Add department'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <Input id="d-name" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            <Select id="d-hod" label="Head of department" value={edit.hodUserId} onChange={(e) => setEdit({ ...edit, hodUserId: e.target.value })} placeholder="Not set" options={staff.map((s) => ({ value: s.id, label: s.fullName }))} />
          </div>
        )}
      </Modal>
    </Section>
  );
}

// ─── Combinations ────────────────────────────────────────────────────────────

function CombinationsTab({ levels, subjects, combinations, classes, flags, refresh }: {
  levels: Level[]; subjects: SubjectRow[]; combinations: Combination[]; classes: { id: string; name: string; levelId: string }[]; flags: { manage: boolean }; refresh: () => void;
}) {
  const [edit, setEdit] = useState<{ id: string | null; name: string; levelId: string; subjectIds: string[]; classIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const offeredIn = (levelId: string) => subjects.filter((s) => s.active && s.levels.some((l) => l.levelId === levelId));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    const r = await api(edit.id ? `/api/academics/combinations/${edit.id}` : '/api/academics/combinations', edit.id ? 'PATCH' : 'POST', { name: edit.name, levelId: edit.levelId, subjectIds: edit.subjectIds, classIds: edit.classIds });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Combination saved');
    setEdit(null);
    refresh();
  }
  async function remove(c: Combination) {
    if (!confirm(`Delete ${c.name}? Students keep the subjects they were given.`)) return;
    const r = await api(`/api/academics/combinations/${c.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    refresh();
  }

  return (
    <Section title="Subject combinations" hint="For example Sciences: Physics, Chemistry, Biology. Give a whole group of students their subjects in one step." action={flags.manage && <Button onClick={() => setEdit({ id: null, name: '', levelId: levels[2]?.id ?? levels[0]?.id ?? '', subjectIds: [], classIds: [] })} disabled={levels.length === 0}>Add combination</Button>}>
      <ul className="divide-y divide-line">
        {combinations.length === 0 && <li className="py-6 text-center text-sm text-muted">No combinations yet.</li>}
        {combinations.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-semibold text-ink">{c.name} <span className="text-sm font-normal text-muted">· {c.level}</span></p>
              <p className="text-sm text-muted">{c.subjects.map((s) => s.name).join(', ')}</p>
              <p className="text-xs text-muted">{c.classes.length ? `Classes: ${c.classes.map((x) => x.name).join(', ')}` : 'Any class of the form'}</p>
            </div>
            {flags.manage && (
              <div className="flex gap-3">
                <button type="button" onClick={() => setEdit({ id: c.id, name: c.name, levelId: c.levelId, subjectIds: c.subjects.map((s) => s.id), classIds: c.classes.map((x) => x.id) })} className="text-sm font-semibold text-primary hover:underline">Edit</button>
                <button type="button" onClick={() => remove(c)} className="text-sm font-semibold text-danger hover:underline">Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? 'Edit combination' : 'Add combination'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <Input id="c-name" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            <Select id="c-level" label="Form" value={edit.levelId} onChange={(e) => setEdit({ ...edit, levelId: e.target.value, subjectIds: [], classIds: [] })} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
            <fieldset><legend className="mb-1 text-sm font-medium text-ink">Subjects</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {offeredIn(edit.levelId).map((s) => (
                  <label key={s.id} className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.subjectIds.includes(s.id)} onChange={() => setEdit({ ...edit, subjectIds: toggle(edit.subjectIds, s.id) })} />{s.name}</label>
                ))}
                {offeredIn(edit.levelId).length === 0 && <p className="text-sm text-muted">No subject is offered in this form yet.</p>}
              </div>
            </fieldset>
            <fieldset><legend className="mb-1 text-sm font-medium text-ink">Classes (leave empty for any class of the form)</legend>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {classes.filter((c) => c.levelId === edit.levelId).map((c) => (
                  <label key={c.id} className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.classIds.includes(c.id)} onChange={() => setEdit({ ...edit, classIds: toggle(edit.classIds, c.id) })} />{c.name}</label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </Modal>
    </Section>
  );
}

// ─── Approvals ───────────────────────────────────────────────────────────────

function ApprovalsTab({ changes, flags, refresh }: { changes: Change[]; flags: { approve: boolean }; refresh: () => void }) {
  const [note, setNote] = useState<Record<string, string>>({});
  async function decide(c: Change, decision: 'APPROVE' | 'REJECT') {
    const r = await api(`/api/academics/subjects/changes/${c.id}`, 'POST', { decision, note: note[c.id] || undefined });
    if (!r.ok) return toast.error(problem(r));
    toast.success(decision === 'APPROVE' ? 'Approved and applied' : 'Rejected');
    refresh();
  }
  return (
    <Section title="Changes to the subject list" hint="The Head approves each change before it takes effect.">
      <ul className="divide-y divide-line">
        {changes.length === 0 && <li className="py-6 text-center text-sm text-muted">Nothing is waiting.</li>}
        {changes.map((c) => (
          <li key={c.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={c.status === 'PENDING' ? 'warning' : c.status === 'APPROVED' ? 'success' : 'danger'} label={c.status === 'PENDING' ? 'Waiting' : c.status === 'APPROVED' ? 'Approved' : 'Rejected'} />
              <span className="font-semibold text-ink">{c.kind === 'CREATE' ? 'New subject' : c.kind === 'UPDATE' ? 'Change to' : c.kind === 'DEACTIVATE' ? 'Make inactive' : 'Make active'}: {String(c.payload.name ?? '')}</span>
              <span className="text-sm text-muted">by {c.requestedBy}{c.decidedBy ? `, decided by ${c.decidedBy}` : ''}</span>
            </div>
            {c.note && <p className="text-sm text-muted">Note: {c.note}</p>}
            {c.status === 'PENDING' && flags.approve && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[200px] flex-1"><Input id={`n-${c.id}`} label="Note (needed to reject)" value={note[c.id] ?? ''} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} /></div>
                <Button onClick={() => decide(c, 'APPROVE')}>Approve</Button>
                <Button variant="danger" onClick={() => decide(c, 'REJECT')}>Reject</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
