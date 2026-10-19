'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, Dot, Notice, problem, Section, Tabs } from '@/components/academics/shared';

type Cell =
  | { state: 'na' } | { state: 'empty' | 'gap' }
  | { state: 'assigned'; assignmentId: string; teacherName: string; initials: string; periodsPerWeek: number }
  | { state: 'group'; assignmentId: string; groupName: string; teacherName: string; initials: string };

interface Grid { classes: { id: string; name: string }[]; subjects: { id: string; name: string; shortName: string; colour: string }[]; cells: Record<string, Cell> }
interface Workload { maxPeriods: number; teachers: { id: string; name: string; initials: string; periods: number; pct: number; status: 'over' | 'ok' | 'under' | 'none'; covers: number; assignments: { id: string; subject: string; target: string; periods: number; second: boolean }[] }[] }
interface Gaps { gaps: { classId: string; className: string; subjectId: string; subjectName: string; students: number; uncovered: number }[]; over: { id: string; name: string; periods: number }[]; under: { id: string; name: string; periods: number }[]; none: { id: string; name: string }[]; maxPeriods: number }
interface Group { id: string; name: string; subjectId: string; subject: string; levelId: string; level: string; students: number; classes: { name: string; count: number }[]; teacher: string | null; assignmentId: string | null }
interface SetInfo { status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'RETURNED'; assignments: number; note: string | null; submittedBy: string | null; approvedBy: string | null }
interface AssignmentRow { id: string; teacherId: string; coTeacherId: string | null; periodsPerWeek: number; doublesPerWeek: number; subjectId: string; classId: string | null; groupId: string | null; target: string; subjectName: string; teacherName: string; approved: boolean }

type Tab = 'grid' | 'teachers' | 'gaps' | 'groups';
type Target = { classId?: string; groupId?: string; subjectId: string; label: string; existing?: AssignmentRow };

const SET_BADGE = { DRAFT: ['neutral', 'Not sent'], PENDING: ['warning', 'Waiting for the Head'], APPROVED: ['success', 'Approved'], RETURNED: ['danger', 'Returned'] } as const;

export function AssignmentsClient({ term, grid, workload, gaps, groups, set, assignments, teachers, subjects, levels, flags }: {
  term: { id: string; name: string; status: string }; grid: Grid; workload: Workload; gaps: Gaps; groups: Group[]; set: SetInfo | null; assignments: AssignmentRow[];
  teachers: { id: string; fullName: string }[]; subjects: { id: string; name: string; electiveLevelIds: string[] }[]; levels: { id: string; name: string }[];
  flags: { manage: boolean; approve: boolean };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('grid');
  const closed = term.status === 'CLOSED';
  const editable = flags.manage && !closed;
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const refresh = () => router.refresh();

  async function send() {
    setBusy(true);
    const r = await api('/api/academics/assignments/set', 'POST', { termId: term.id });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(r.body.data.gaps ? `Sent to the Head (${r.body.data.gaps} subject gaps remain)` : 'Sent to the Head for approval');
    refresh();
  }
  async function decide(decision: 'APPROVE' | 'RETURN') {
    setBusy(true);
    const r = await api('/api/academics/assignments/set/decide', 'POST', { termId: term.id, decision, note: note || undefined });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(decision === 'APPROVE' ? 'Teacher assignments approved' : 'Returned to the administrator');
    setNote('');
    refresh();
  }

  const tabs = [
    { id: 'grid' as const, label: 'By class' }, { id: 'teachers' as const, label: 'By teacher' },
    { id: 'gaps' as const, label: 'Gaps', badge: gaps.gaps.length + gaps.over.length || undefined }, { id: 'groups' as const, label: 'Teaching groups', badge: groups.length || undefined },
  ];

  return (
    <div className="flex flex-col gap-4">
      {closed && <ClosedNotice termName={term.name} />}
      {set && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">Approval for {term.name}</span>
            <Badge variant={SET_BADGE[set.status][0]} label={SET_BADGE[set.status][1]} />
            <span className="text-sm text-muted">{set.assignments} assignments{set.approvedBy ? ` · approved by ${set.approvedBy}` : set.submittedBy ? ` · sent by ${set.submittedBy}` : ''}</span>
            {set.note && <span className="text-sm text-warn">Note: {set.note}</span>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {flags.manage && !closed && (set.status === 'DRAFT' || set.status === 'RETURNED') && <Button onClick={send} loading={busy} disabled={set.assignments === 0}>Send for Head approval</Button>}
            {flags.approve && !closed && set.status === 'PENDING' && (
              <>
                <div className="w-56"><Input id="set-note" label="Note (needed to return)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
                <Button onClick={() => decide('APPROVE')} loading={busy}>Approve</Button>
                <Button variant="secondary" onClick={() => decide('RETURN')} loading={busy}>Return</Button>
              </>
            )}
          </div>
        </div>
      )}
      {set?.status === 'APPROVED' && editable && <Notice tone="info">The set is approved. You can still fix single assignments; each change is logged.</Notice>}

      <Tabs label="Teacher assignments" tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'grid' && (
        <Section title="By class" hint="Classes down the side, subjects across the top, the teacher's initials in each cell. Gaps are highlighted: click one to fill it.">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <caption className="sr-only">Teacher for each subject in each class</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-white px-2 py-2 text-left text-xs font-semibold uppercase text-muted">Class</th>
                  {grid.subjects.map((s) => <th key={s.id} scope="col" className="px-1 py-2 text-center text-xs font-semibold text-muted"><span className="flex flex-col items-center gap-1"><Dot colour={s.colour} />{s.shortName}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {grid.classes.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <th scope="row" className="sticky left-0 whitespace-nowrap bg-white px-2 py-1.5 text-left font-semibold text-ink">{c.name}</th>
                    {grid.subjects.map((s) => {
                      const cell = grid.cells[`${c.id}:${s.id}`] ?? { state: 'na' };
                      const open = () => { if (!editable) return; setTarget({ classId: c.id, subjectId: s.id, label: `${s.name} · ${c.name}`, existing: cell.state === 'assigned' ? assignments.find((a) => a.id === cell.assignmentId) : undefined }); };
                      return (
                        <td key={s.id} className="px-0.5 py-0.5 text-center">
                          {cell.state === 'na' && <span className="text-muted/40">·</span>}
                          {cell.state === 'assigned' && <button type="button" onClick={open} title={`${cell.teacherName}, ${cell.periodsPerWeek} periods`} className="min-h-[36px] min-w-[44px] rounded-lg bg-tint px-2 font-semibold text-primary hover:ring-2 hover:ring-primary/30">{cell.initials}</button>}
                          {cell.state === 'group' && <span title={`${cell.groupName}: ${cell.teacherName}`} className="inline-flex min-h-[36px] min-w-[44px] items-center justify-center rounded-lg bg-canvas px-2 font-semibold text-muted">{cell.initials}<sup className="ml-0.5 text-[9px]">G</sup></span>}
                          {cell.state === 'gap' && <button type="button" onClick={open} disabled={!editable} aria-label={`No teacher for ${s.name} in ${c.name}`} className="min-h-[36px] min-w-[44px] rounded-lg border-2 border-dashed border-danger/50 bg-danger-bg font-bold text-danger">+</button>}
                          {cell.state === 'empty' && <button type="button" onClick={open} disabled={!editable} aria-label={`Assign ${s.name} in ${c.name}`} className="min-h-[36px] min-w-[44px] rounded-lg border border-dashed border-line text-muted hover:border-primary">+</button>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Red + : students take the subject but nobody teaches it. Grey + : optional, nobody chose it yet. G: taught through a teaching group.</p>
        </Section>
      )}

      {tab === 'teachers' && (
        <Section title="By teacher" hint={`Periods a week against the school's maximum of ${workload.maxPeriods}.`}>
          <ul className="divide-y divide-line">
            {workload.teachers.length === 0 && <li className="py-6 text-center text-sm text-muted">No teachers yet.</li>}
            {workload.teachers.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{t.name} <span className="text-sm font-normal text-muted">({t.initials})</span></span>
                  <span className="text-sm"><b className={t.status === 'over' ? 'text-danger' : ''}>{t.periods}</b> / {workload.maxPeriods} periods{t.covers > 0 && <span className="text-muted"> · {t.covers} cover{t.covers === 1 ? '' : 's'}</span>}</span>
                </div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={workload.maxPeriods} aria-valuenow={t.periods} aria-label={`${t.name} workload`} className="h-2.5 overflow-hidden rounded-full bg-canvas">
                  <div className={`h-full rounded-full ${t.status === 'over' ? 'bg-danger' : t.status === 'under' ? 'bg-gold' : 'bg-primary'}`} style={{ width: `${Math.min(100, t.pct)}%` }} />
                </div>
                <p className="text-sm text-muted">{t.assignments.length ? t.assignments.map((a) => `${a.subject} ${a.target} (${a.periods})${a.second ? ' second teacher' : ''}`).join(' · ') : 'No lessons assigned.'}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {tab === 'gaps' && (
        <div className="flex flex-col gap-4">
          <Section title="Subjects with no teacher" hint="Every subject a class takes that nobody teaches.">
            <ul className="divide-y divide-line">
              {gaps.gaps.length === 0 && <li className="py-6 text-center text-sm text-success">Every subject has a teacher.</li>}
              {gaps.gaps.map((g) => (
                <li key={g.classId + g.subjectId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-sm"><b>{g.subjectName}</b> has no teacher in {g.className} <span className="text-muted">({g.uncovered} of {g.students} students)</span></span>
                  {editable && <button type="button" onClick={() => setTarget({ classId: g.classId, subjectId: g.subjectId, label: `${g.subjectName} · ${g.className}` })} className="text-sm font-semibold text-primary hover:underline">Assign</button>}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Teaching load" hint={`Over ${gaps.maxPeriods} periods a week is too many; less than half is light.`}>
            <ul className="divide-y divide-line text-sm">
              {gaps.over.map((t) => <li key={t.id} className="flex justify-between py-2"><span>{t.name}</span><Badge variant="danger" label={`${t.periods} periods: over`} /></li>)}
              {gaps.under.map((t) => <li key={t.id} className="flex justify-between py-2"><span>{t.name}</span><Badge variant="warning" label={`${t.periods} periods: light`} /></li>)}
              {gaps.none.map((t) => <li key={t.id} className="flex justify-between py-2"><span>{t.name}</span><Badge label="No lessons" /></li>)}
              {gaps.over.length + gaps.under.length + gaps.none.length === 0 && <li className="py-6 text-center text-success">Everyone has a fair load.</li>}
            </ul>
          </Section>
        </div>
      )}

      {tab === 'groups' && <GroupsTab {...{ groups, subjects, levels, editable, refresh, openAssign: (g: Group) => setTarget({ groupId: g.id, subjectId: g.subjectId, label: `${g.subject} · ${g.name}`, existing: assignments.find((a) => a.groupId === g.id) }) }} />}

      <AssignModal target={target} onClose={() => setTarget(null)} teachers={teachers} termId={term.id} refresh={refresh} />
    </div>
  );
}

// ─── Teaching groups ─────────────────────────────────────────────────────────

function GroupsTab({ groups, subjects, levels, editable, refresh, openAssign }: {
  groups: Group[]; subjects: { id: string; name: string; electiveLevelIds: string[] }[]; levels: { id: string; name: string }[]; editable: boolean; refresh: () => void; openAssign: (g: Group) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; subjectId: string; levelId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => subjects.filter((s) => draft && s.electiveLevelIds.includes(draft.levelId)), [subjects, draft]);

  async function create() {
    if (!draft) return;
    setBusy(true);
    const r = await api('/api/academics/teaching-groups', 'POST', draft);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(`Group made with ${r.body.data.students} students`);
    setDraft(null);
    refresh();
  }
  async function act(g: Group, what: 'sync' | 'delete') {
    if (what === 'delete' && !confirm(`Delete ${g.name}?`)) return;
    const r = what === 'sync' ? await api(`/api/academics/teaching-groups/${g.id}/sync`, 'POST') : await api(`/api/academics/teaching-groups/${g.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    toast.success(what === 'sync' ? `Up to date (+${r.body.data.added}, −${r.body.data.removed})` : 'Group deleted');
    refresh();
  }

  return (
    <Section title="Teaching groups" hint="An elective taught across classes, for example Form 3 Accounts for the Accounts students of every Form 3 class. The students come from their subject choices." action={editable && <Button onClick={() => setDraft({ name: '', subjectId: '', levelId: levels[2]?.id ?? levels[0]?.id ?? '' })}>Add group</Button>}>
      <ul className="divide-y divide-line">
        {groups.length === 0 && <li className="py-6 text-center text-sm text-muted">No teaching groups yet.</li>}
        {groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-semibold text-ink">{g.name} <span className="text-sm font-normal text-muted">· {g.students} students</span></p>
              <p className="text-sm text-muted">{g.classes.map((c) => `${c.name}: ${c.count}`).join(', ') || 'No students yet'} · Teacher: {g.teacher ?? <span className="text-danger">none</span>}</p>
            </div>
            {editable && (
              <div className="flex gap-3">
                <button type="button" onClick={() => openAssign(g)} className="text-sm font-semibold text-primary hover:underline">{g.teacher ? 'Teacher' : 'Assign teacher'}</button>
                <button type="button" onClick={() => act(g, 'sync')} className="text-sm font-semibold text-primary hover:underline">Refresh students</button>
                <button type="button" onClick={() => act(g, 'delete')} className="text-sm font-semibold text-danger hover:underline">Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!draft} onClose={() => setDraft(null)} title="Add a teaching group" footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={create} loading={busy} disabled={!draft?.name || !draft?.subjectId}>Make group</Button></>}>
        {draft && (
          <div className="flex flex-col gap-3">
            <Select id="g-level" label="Form" value={draft.levelId} onChange={(e) => setDraft({ ...draft, levelId: e.target.value, subjectId: '' })} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
            <Select id="g-subject" label="Elective subject" value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value, name: draft.name || `${levels.find((l) => l.id === draft.levelId)?.name ?? ''} ${subjects.find((s) => s.id === e.target.value)?.name ?? ''}`.trim() })} placeholder="Choose" options={options.map((s) => ({ value: s.id, label: s.name }))} />
            <Input id="g-name" label="Group name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
        )}
      </Modal>
    </Section>
  );
}

// ─── Assign, change, end ─────────────────────────────────────────────────────

function AssignModal({ target, onClose, teachers, termId, refresh }: { target: Target | null; onClose: () => void; teachers: { id: string; fullName: string }[]; termId: string; refresh: () => void }) {
  const [teacherId, setTeacherId] = useState('');
  const [coId, setCoId] = useState('');
  const [periods, setPeriods] = useState('4');
  const [doubles, setDoubles] = useState('0');
  const [mode, setMode] = useState<'edit' | 'replace'>('edit');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [newTeacher, setNewTeacher] = useState('');
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState('');

  // Reset the form when a different cell is opened.
  const key = target ? `${target.classId ?? target.groupId}:${target.subjectId}:${target.existing?.id ?? ''}` : '';
  if (key !== sig) {
    setSig(key);
    setTeacherId(target?.existing?.teacherId ?? ''); setCoId(target?.existing?.coTeacherId ?? '');
    setPeriods(String(target?.existing?.periodsPerWeek ?? 4)); setDoubles(String(target?.existing?.doublesPerWeek ?? 0));
    setMode('edit'); setDate(''); setReason(''); setNewTeacher('');
  }

  async function run(fn: () => Promise<{ ok: boolean; body: { data?: { warnings?: string[] } }; status: number }>, done: string) {
    setBusy(true);
    const r = (await fn()) as Awaited<ReturnType<typeof api>>;
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const w = (r.body.data?.warnings ?? []) as string[];
    toast.success(w.length ? `${done}. Note: ${w[0]}` : done);
    onClose();
    refresh();
  }

  if (!target) return <Modal open={false} onClose={onClose} title=""><span /></Modal>;
  const ex = target.existing;
  const people = teachers.map((t) => ({ value: t.id, label: t.fullName }));

  return (
    <Modal
      open onClose={onClose} title={ex ? `${target.label}` : `Assign: ${target.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {!ex && <Button loading={busy} disabled={!teacherId} onClick={() => run(() => api('/api/academics/assignments', 'POST', { termId, teacherId, coTeacherId: coId || null, subjectId: target.subjectId, classId: target.classId ?? null, groupId: target.groupId ?? null, periodsPerWeek: Number(periods), doublesPerWeek: Number(doubles) }), 'Teacher assigned')}>Assign</Button>}
          {ex && mode === 'edit' && <Button loading={busy} onClick={() => run(() => api(`/api/academics/assignments/${ex.id}`, 'PATCH', { periodsPerWeek: Number(periods), doublesPerWeek: Number(doubles), coTeacherId: coId || null }), 'Saved')}>Save</Button>}
          {ex && mode === 'replace' && <Button loading={busy} disabled={!newTeacher || !date} onClick={() => run(() => api(`/api/academics/assignments/${ex.id}/replace`, 'POST', { teacherId: newTeacher, effectiveDate: date, reason: reason || undefined }), 'Teacher changed')}>Change teacher</Button>}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {ex && <p className="text-sm text-ink">Taught by <b>{ex.teacherName}</b>{ex.approved ? '' : ' (not yet approved)'}.</p>}
        {(!ex || mode === 'edit') && (
          <>
            {!ex && <Select id="a-teacher" label="Teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} placeholder="Choose a teacher" options={people} hint="Only active users with the Teacher role." />}
            <div className="grid grid-cols-2 gap-3">
              <Input id="a-periods" type="number" min={1} max={40} label="Periods a week" value={periods} onChange={(e) => setPeriods(e.target.value)} />
              <Input id="a-doubles" type="number" min={0} max={20} label="Double periods" value={doubles} onChange={(e) => setDoubles(e.target.value)} hint="Each uses two periods." />
            </div>
            <Select id="a-co" label="Second teacher (optional)" value={coId} onChange={(e) => setCoId(e.target.value)} placeholder="None" options={people.filter((p) => p.value !== (ex?.teacherId ?? teacherId))} />
          </>
        )}
        {ex && mode === 'edit' && (
          <div className="flex flex-wrap gap-4 border-t border-line pt-3 text-sm">
            <button type="button" onClick={() => setMode('replace')} className="font-semibold text-primary hover:underline">Change the teacher from a date…</button>
            <button type="button" className="font-semibold text-danger hover:underline" onClick={() => { if (confirm('Stop this assignment? It ends today and the lessons come off the timetable draft.')) void run(() => api(`/api/academics/assignments/${ex.id}/end`, 'POST', {}), 'Assignment ended'); }}>End it</button>
            <button type="button" className="font-semibold text-muted hover:underline" onClick={() => { if (confirm('Delete this assignment? Only possible while it has no lessons, scheme or marks.')) void run(() => api(`/api/academics/assignments/${ex.id}`, 'DELETE'), 'Assignment removed'); }}>Delete (made by mistake)</button>
          </div>
        )}
        {ex && mode === 'replace' && (
          <>
            <Notice tone="info">The old assignment ends the day before and a new one starts, so marks and registers already recorded keep {ex.teacherName}.</Notice>
            <Select id="a-new" label="New teacher" value={newTeacher} onChange={(e) => setNewTeacher(e.target.value)} placeholder="Choose" options={people.filter((p) => p.value !== ex.teacherId)} />
            <Input id="a-date" type="date" label="From (first day of the new teacher)" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input id="a-reason" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" onClick={() => setMode('edit')} className="self-start text-sm font-semibold text-primary hover:underline">Back</button>
          </>
        )}
      </div>
    </Modal>
  );
}
