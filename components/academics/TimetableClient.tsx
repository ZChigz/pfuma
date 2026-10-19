'use client';

// The timetable builder. A week grid for one class (or teacher, room, or the whole school) with a "To place" list built from the
// teacher assignments. Click a lesson then a slot, or drag it. "Suggest a slot" colours every slot where it fits without a clash.
// The system refuses clashes and says why; warnings (amber) are allowed.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, Dot, linkButton, Notice, problem, Section, Tabs } from '@/components/academics/shared';
import { WeekGrid, type DragPayload, type GridDayData, type GridSlot, type Hint } from '@/components/academics/WeekGrid';

type Kind = 'class' | 'teacher' | 'room' | 'master';
interface ToPlace { assignmentId: string; subject: string; shortName: string; colour: string; teacher: string; target: string; placed: number; needed: number; doublesPlaced: number; doublesNeeded: number; isGroup: boolean }
interface ViewData {
  term: { id: string; name: string; status: string }; title: string; subjectId: string | null;
  timetable: { id: string; version: number; status: string; effectiveFrom: string | null } | null; draftExists: boolean;
  days: GridDayData[]; cells: Record<string, GridSlot[]>; toPlace: ToPlace[]; rooms: { id: string; name: string; type: string; capacity: number }[]; canEdit: boolean; editable: boolean; unavailable: string[];
}
interface State {
  term: { id: string; name: string; status: string }; hasSchedule: boolean; working: { id: string; version: number; status: string; lessons: number } | null;
  published: { version: number; effectiveFrom: string | null } | null; versions: { id: string; version: number; status: string; effectiveFrom: string | null; lessons: number }[];
  assignments: number; fullyPlaced: number; unplaced: { assignmentId: string; subject: string; target: string; teacher: string; placed: number; needed: number; doublesPlaced: number; doublesNeeded: number }[];
}

const STATUS: Record<string, ['neutral' | 'warning' | 'success' | 'info', string]> = { DRAFT: ['warning', 'Draft'], PENDING: ['info', 'Waiting for the Head'], PUBLISHED: ['success', 'Published'], SUPERSEDED: ['neutral', 'Replaced'] };

export function TimetableClient({ termId, state, classes, teachers, rooms, initialKind, initialId, flags, myId }: {
  termId: string; state: State; classes: { id: string; name: string }[]; teachers: { id: string; fullName: string }[]; rooms: { id: string; name: string }[];
  initialKind: Kind; initialId: string | null; flags: { edit: boolean; approve: boolean; seesAll: boolean }; myId: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [subjectId, setSubjectId] = useState<string | null>(initialId);
  const [version, setVersion] = useState<string>(flags.edit && (state.working || !state.published) ? 'working' : 'published');
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [armed, setArmed] = useState<ToPlace | null>(null);
  const [moving, setMoving] = useState<GridSlot | null>(null);
  const [roomId, setRoomId] = useState('');
  const [isDouble, setIsDouble] = useState(false);
  const [hints, setHints] = useState<Record<string, { hint: Hint; text: string }>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [slot, setSlot] = useState<GridSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [effective, setEffective] = useState('');
  const [returnNote, setReturnNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ termId, view: kind, version });
    if (subjectId) qs.set('id', subjectId);
    const r = await api(`/api/academics/timetable/view?${qs}`);
    setLoading(false);
    if (!r.ok) { setData(null); toast.error(problem(r)); return; }
    setData(r.body.data as ViewData);
  }, [termId, kind, subjectId, version]);

  useEffect(() => { void load(); }, [load]);

  const editable = !!data?.editable;
  const closed = state.term.status === 'CLOSED';

  const subjectOptions = kind === 'class' ? classes.map((c) => ({ value: c.id, label: c.name })) : kind === 'teacher' ? teachers.map((t) => ({ value: t.id, label: t.fullName })) : kind === 'room' ? rooms.map((r) => ({ value: r.id, label: r.name })) : [];

  function changeKind(k: Kind) {
    setKind(k);
    setArmed(null); setMoving(null); setHints({});
    setSubjectId(k === 'class' ? classes[0]?.id ?? null : k === 'teacher' ? (flags.seesAll ? teachers[0]?.id : myId) ?? null : k === 'room' ? rooms[0]?.id ?? null : null);
  }

  async function place(assignmentId: string, periodId: string, replaceSlotId?: string, opts?: { roomId?: string; isDouble?: boolean }) {
    setBusy(true);
    const r = await api('/api/academics/timetable/place', 'POST', { termId, assignmentId, periodId, roomId: (opts?.roomId ?? roomId) || null, isDouble: opts?.isDouble ?? isDouble, replaceSlotId });
    setBusy(false);
    if (!r.ok) { toast.error(problem(r)); return false; }
    setNotes((r.body.data.warnings ?? []) as string[]);
    setMoving(null); setHints({});
    router.refresh();
    await load();
    return true;
  }

  async function suggest() {
    if (!armed) return;
    const r = await api('/api/academics/timetable/suggest', 'POST', { assignmentId: armed.assignmentId, isDouble, roomId: roomId || null });
    if (!r.ok) return toast.error(problem(r));
    const h: Record<string, { hint: Hint; text: string }> = {};
    for (const s of r.body.data.slots as { periodId: string; free: boolean; reasons: string[]; warnings: string[] }[]) {
      h[s.periodId] = s.free ? { hint: s.warnings.length ? 'warn' : 'free', text: s.warnings[0] ?? 'Fits here' } : { hint: 'busy', text: s.reasons[0] ?? '' };
    }
    setHints(h);
    const n = Object.values(h).filter((x) => x.hint !== 'busy').length;
    toast.info(n ? `${n} slot${n === 1 ? '' : 's'} where it fits` : 'It does not fit anywhere. Free a slot first.');
  }

  function onCell(periodId: string) {
    if (!editable) return;
    if (moving) void place(moving.assignmentId, periodId, moving.slotId, { roomId: moving.roomId ?? '', isDouble: moving.isDouble });
    else if (armed) void place(armed.assignmentId, periodId);
    else toast.info('Choose a lesson from the "To place" list first.');
  }
  function onDrop(periodId: string, p: DragPayload) {
    if (!editable) return;
    if (p.kind === 'assignment') void place(p.assignmentId, periodId);
    else { const s = Object.values(data?.cells ?? {}).flat().find((x) => x.slotId === p.slotId); if (s) void place(s.assignmentId, periodId, s.slotId, { roomId: s.roomId ?? '', isDouble: s.isDouble }); }
  }

  async function removeSlot(s: GridSlot) {
    const r = await api(`/api/academics/timetable/slots/${s.slotId}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    toast.success('Lesson taken off');
    setSlot(null);
    router.refresh(); await load();
  }
  async function roomOf(s: GridSlot, id: string) {
    const r = await api(`/api/academics/timetable/slots/${s.slotId}`, 'PATCH', { roomId: id || null });
    if (!r.ok) return toast.error(problem(r));
    setNotes((r.body.data.warnings ?? []) as string[]);
    setSlot(null);
    router.refresh(); await load();
  }

  async function act(url: string, body: object, done: string) {
    setBusy(true);
    const r = await api(url, 'POST', { termId, ...body });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(done);
    router.refresh(); await load();
  }

  const w = state.working;
  const st = w ? STATUS[w.status] : state.published ? STATUS.PUBLISHED : null;
  const incomplete = state.unplaced.length;
  const tabs = useMemo(() => [
    { id: 'class' as const, label: 'Class' }, { id: 'teacher' as const, label: 'Teacher' },
    ...(flags.seesAll ? [{ id: 'room' as const, label: 'Room' }, { id: 'master' as const, label: 'Whole school' }] : []),
  ], [flags.seesAll]);

  return (
    <div className="flex flex-col gap-4">
      {closed && <ClosedNotice termName={state.term.name} />}
      {!state.hasSchedule && <Notice tone="warn">There is no bell schedule yet. <Link href="/academics/timetable/setup" className="font-semibold underline">Set up the periods</Link> before building the timetable.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{state.term.name}</span>
          {st && <Badge variant={st[0]} label={w ? `Version ${w.version}: ${st[1]}` : `Version ${state.published?.version}: ${st[1]}`} />}
          {state.published && <span className="text-sm text-muted">In force from {state.published.effectiveFrom}</span>}
          {w && <span className="text-sm text-muted">{incomplete === 0 ? 'Every lesson is placed.' : `${incomplete} assignment${incomplete === 1 ? '' : 's'} not fully placed`}</span>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {flags.edit && (state.working || state.published) && (
            <Select id="tt-version" aria-label="Version" value={version} onChange={(e) => setVersion(e.target.value)} options={[...(state.working ? [{ value: 'working', label: 'Being written' }] : []), ...(state.published ? [{ value: 'published', label: 'Published' }] : []), ...state.versions.filter((v) => v.status === 'SUPERSEDED').map((v) => ({ value: String(v.version), label: `Version ${v.version} (old)` }))]} />
          )}
          {flags.edit && !closed && !w && state.published && <Button variant="secondary" loading={busy} onClick={() => act('/api/academics/timetable/new-version', {}, 'A new version was started')}>Change the published timetable</Button>}
          {flags.edit && !closed && w?.status === 'DRAFT' && <Button loading={busy} onClick={() => act('/api/academics/timetable/submit', {}, 'Sent for Head approval')} title="Checks that every lesson is placed and nothing clashes">Check and send for approval</Button>}
        </div>
      </div>

      {flags.approve && !closed && w?.status === 'PENDING' && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
          <p className="w-full text-sm font-semibold text-ink">Version {w.version} is waiting for approval.</p>
          <div className="w-44"><Input id="tt-eff" type="date" label="In force from" value={effective} onChange={(e) => setEffective(e.target.value)} hint="Leave empty for today" /></div>
          <Button loading={busy} onClick={() => act('/api/academics/timetable/decide', { decision: 'APPROVE', effectiveFrom: effective || undefined }, 'Timetable published. Teachers have been told.')}>Approve and publish</Button>
          <div className="min-w-[200px] flex-1"><Input id="tt-note" label="Note (needed to return)" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} /></div>
          <Button variant="secondary" loading={busy} onClick={() => act('/api/academics/timetable/decide', { decision: 'RETURN', note: returnNote }, 'Returned to the Deputy')}>Return</Button>
        </div>
      )}
      {w?.status === 'PENDING' && !flags.approve && <Notice tone="info">The timetable is with the Head for approval. It cannot be changed until it is returned.</Notice>}
      {flags.edit && w?.status === 'DRAFT' && incomplete > 0 && state.unplaced.length <= 6 && (
        <details className="rounded-xl bg-white p-3 text-sm"><summary className="cursor-pointer font-semibold text-ink">What is still to place</summary>
          <ul className="mt-2 list-disc pl-5 text-muted">{state.unplaced.map((u) => <li key={u.assignmentId}>{u.subject}, {u.target} ({u.teacher}): {u.placed} of {u.needed} periods{u.doublesNeeded > u.doublesPlaced ? `, ${u.doublesPlaced} of ${u.doublesNeeded} doubles` : ''}</li>)}</ul></details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Tabs label="Timetable views" tabs={tabs} value={kind} onChange={changeKind} />
        {kind !== 'master' && (kind === 'class' || flags.seesAll) && (
          <div className="min-w-[200px]"><Select id="tt-subject" aria-label="Which" value={subjectId ?? ''} onChange={(e) => { setSubjectId(e.target.value || null); setHints({}); }} options={subjectOptions} /></div>
        )}
        {data?.timetable && <Link href={`/print/academics/timetable?view=${kind}${subjectId ? `&id=${subjectId}` : ''}${version === 'working' ? '&version=working' : ''}`} target="_blank" className={linkButton}>Print (A4 landscape)</Link>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {loading && !data && <p className="rounded-2xl bg-white p-8 text-center text-sm text-muted">Loading…</p>}
          {data && (
            <>
              <h2 className="mb-2 text-lg font-bold text-ink">{data.title}{data.timetable ? <span className="ml-2 text-sm font-normal text-muted">version {data.timetable.version}</span> : null}</h2>
              {!data.timetable && <Notice tone="info">{data.canEdit ? 'Nothing is placed yet. Pick a lesson from the list and click a slot.' : 'No timetable has been published for this term yet.'}</Notice>}
              <WeekGrid
                days={data.days} cells={data.cells} view={kind} hints={hints} unavailable={data.unavailable} selectedSlotId={moving?.slotId}
                onCell={editable ? onCell : undefined} onDropOn={editable ? onDrop : undefined} onSlot={editable ? (s) => setSlot(s) : undefined}
              />
              {notes.length > 0 && <div className="mt-3 flex flex-col gap-2">{notes.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}</div>}
            </>
          )}
        </div>

        {data && (kind === 'class' || kind === 'teacher') && (
          <aside aria-label="To place" className="flex flex-col gap-3 xl:sticky xl:top-0 xl:self-start">
            <Section title="To place" hint={editable ? 'Click a lesson, then a slot. Or drag it.' : undefined}>
              <ul className="flex flex-col gap-1.5">
                {data.toPlace.length === 0 && <li className="text-sm text-muted">No teacher assignments for this {kind}.</li>}
                {data.toPlace.map((p) => {
                  const done = p.placed >= p.needed && p.doublesPlaced >= p.doublesNeeded;
                  return (
                    <li key={p.assignmentId}>
                      <button
                        type="button" disabled={!editable || done} onClick={() => { setArmed(armed?.assignmentId === p.assignmentId ? null : p); setMoving(null); setHints({}); }}
                        draggable={editable && !done} onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'assignment', assignmentId: p.assignmentId }))}
                        className={`flex w-full flex-col rounded-xl border px-3 py-2 text-left ${armed?.assignmentId === p.assignmentId ? 'border-primary bg-tint' : 'border-line bg-white'} ${done ? 'opacity-60' : 'hover:border-primary'}`}
                      >
                        <span className="flex items-center gap-2 font-semibold text-ink"><Dot colour={p.colour} />{p.shortName}{p.isGroup && <span className="rounded bg-canvas px-1 text-[10px] text-muted">GROUP</span>}</span>
                        <span className="text-xs text-muted">{kind === 'class' ? p.teacher : p.target} · {p.placed} of {p.needed} periods placed{p.doublesNeeded ? `, ${p.doublesPlaced} of ${p.doublesNeeded} doubles` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
            {editable && (armed || moving) && (
              <Section title={moving ? `Moving ${moving.shortName}` : `Placing ${armed?.shortName}`}>
                <div className="flex flex-col gap-3">
                  {!moving && <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={isDouble} onChange={(e) => { setIsDouble(e.target.checked); setHints({}); }} />Double period</label>}
                  {!moving && <Select id="tt-room" label="Room" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="No room" options={data.rooms.map((r) => ({ value: r.id, label: `${r.name} (${r.capacity})` }))} />}
                  {!moving && <Button variant="secondary" onClick={suggest}>Suggest a slot</Button>}
                  <Button variant="ghost" onClick={() => { setArmed(null); setMoving(null); setHints({}); }}>Cancel</Button>
                  {busy && <p className="text-xs text-muted">Placing…</p>}
                </div>
              </Section>
            )}
          </aside>
        )}
      </div>

      <Modal open={!!slot} onClose={() => setSlot(null)} title={slot ? `${slot.subject}: ${slot.target}` : ''} footer={<Button variant="secondary" onClick={() => setSlot(null)}>Close</Button>}>
        {slot && (
          <div className="flex flex-col gap-3 text-sm">
            <p><b>{slot.teacher}</b>{slot.room ? ` · ${slot.room}` : ''}{slot.isDouble ? ' · double period' : ''}</p>
            <Select id="slot-room" label="Room" value={slot.roomId ?? ''} onChange={(e) => void roomOf(slot, e.target.value)} placeholder="No room" options={(data?.rooms ?? []).map((r) => ({ value: r.id, label: r.name }))} />
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => { setMoving(slot); setArmed(null); setSlot(null); toast.info('Now click the slot to move it to.'); }}>Move…</Button>
              <Button variant="danger" onClick={() => removeSlot(slot)}>Take off the timetable</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
