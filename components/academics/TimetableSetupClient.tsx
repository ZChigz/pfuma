'use client';

// The bell schedule (periods of each school day, with breaks as non-teaching slots, a short Friday if you like), the rooms, and
// the periods each teacher cannot teach.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, ClosedNotice, Notice, problem, Section, Tabs, Td, Th, DAY_SHORT } from '@/components/academics/shared';

interface P { periodNo: number; label: string; start: string; end: string; type: 'LESSON' | 'BREAK' | 'ASSEMBLY' | 'SPORTS'; id?: string }
type Days = Record<number, P[]>;
interface Room { id: string; name: string; type: string; capacity: number; active: boolean; lessons: number }

const DAY_NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPES = [{ value: 'LESSON', label: 'Lesson' }, { value: 'BREAK', label: 'Break' }, { value: 'ASSEMBLY', label: 'Assembly' }, { value: 'SPORTS', label: 'Sports' }];
const ROOM_TYPES = [{ value: 'CLASSROOM', label: 'Classroom' }, { value: 'LABORATORY', label: 'Laboratory' }, { value: 'COMPUTER_LAB', label: 'Computer lab' }, { value: 'WORKSHOP', label: 'Workshop' }, { value: 'HALL', label: 'Hall' }, { value: 'FIELD', label: 'Field' }];

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function generate(o: { start: string; lesson: number; before: number; brk: number; after: number }): P[] {
  const out: P[] = [];
  let t = toMin(o.start), no = 1;
  const lesson = () => { out.push({ periodNo: no++, label: '', start: toHm(t), end: toHm(t + o.lesson), type: 'LESSON' }); t += o.lesson; };
  for (let i = 0; i < o.before; i++) lesson();
  if (o.brk > 0) { out.push({ periodNo: no++, label: 'Tea', start: toHm(t), end: toHm(t + o.brk), type: 'BREAK' }); t += o.brk; }
  for (let i = 0; i < o.after; i++) lesson();
  return out;
}

export function TimetableSetupClient({ term, bell, scope, hasTermSchedule, inUse, rooms, teachers, unavailable, selectedTeacher, periodsForAvailability }: {
  term: { id: string; name: string; status: string };
  bell: { days: { dayOfWeek: number; periods: { id: string; periodNo: number; label: string | null; start: string; end: string; type: P['type'] }[] }[] };
  scope: 'SCHOOL' | 'TERM' | 'NONE'; hasTermSchedule: boolean; inUse: boolean; rooms: Room[]; teachers: { id: string; fullName: string }[];
  unavailable: string[]; selectedTeacher: string | null; periodsForAvailability: { id: string; dayOfWeek: number; periodNo: number; start: string; type: string }[];
}) {
  const router = useRouter();
  const closed = term.status === 'CLOSED';
  const [tab, setTab] = useState<'bell' | 'rooms' | 'availability'>('bell');
  const [days, setDays] = useState<Days>(() => Object.fromEntries(bell.days.map((d) => [d.dayOfWeek, d.periods.map((p) => ({ ...p, label: p.label ?? '' }))])));
  const [forTerm, setForTerm] = useState(scope === 'TERM');
  const [quick, setQuick] = useState({ start: '07:30', lesson: 35, before: 3, brk: 20, after: 3 });
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState<{ id: string | null; name: string; type: string; capacity: string; active: boolean } | null>(null);
  const [off, setOff] = useState<string[]>(unavailable);

  const dayList = Object.keys(days).map(Number).sort();
  const setDay = (d: number, rows: P[]) => setDays({ ...days, [d]: rows });
  const renumber = (rows: P[]) => [...rows].sort((a, b) => a.start.localeCompare(b.start)).map((p, i) => ({ ...p, periodNo: i + 1 }));

  async function saveBell() {
    setBusy(true);
    const r = await api('/api/academics/bell', 'PUT', {
      termId: forTerm ? term.id : null, name: 'Bell schedule',
      days: dayList.map((d) => ({ dayOfWeek: d, periods: days[d]!.map((p) => ({ periodNo: p.periodNo, label: p.label || null, start: p.start, end: p.end, type: p.type })) })),
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(`Bell schedule saved (${r.body.data.added} added, ${r.body.data.changed} changed, ${r.body.data.removed} removed)`);
    router.refresh();
  }
  async function saveRoom() {
    if (!room) return;
    setBusy(true);
    const r = await api(room.id ? `/api/academics/rooms/${room.id}` : '/api/academics/rooms', room.id ? 'PATCH' : 'POST', { name: room.name, type: room.type, capacity: Number(room.capacity), active: room.active });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setRoom(null);
    router.refresh();
  }
  async function deleteRoom(r0: Room) {
    if (!confirm(`Delete ${r0.name}?`)) return;
    const r = await api(`/api/academics/rooms/${r0.id}`, 'DELETE');
    if (!r.ok) return toast.error(problem(r));
    router.refresh();
  }
  async function saveAvailability() {
    if (!selectedTeacher) return;
    setBusy(true);
    const r = await api(`/api/academics/availability/${selectedTeacher}`, 'PUT', { termId: term.id, unavailable: off });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Availability saved');
    router.refresh();
  }

  const availRows = Array.from(new Set(periodsForAvailability.map((p) => p.periodNo))).sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      {closed && <ClosedNotice termName={term.name} />}
      <Tabs label="Setup" value={tab} onChange={setTab} tabs={[{ id: 'bell', label: 'Bell schedule' }, { id: 'rooms', label: 'Rooms', badge: rooms.length }, { id: 'availability', label: 'Teacher availability' }]} />

      {tab === 'bell' && (
        <Section title="Bell schedule" hint="The periods of each day, with start and end times. Breaks, assembly and sports are non-teaching slots. Different days can differ (for example a short Friday).">
          {inUse && <Notice tone="info">Lessons are already on the timetable. Times can change; a period with lessons on it cannot be removed.</Notice>}
          <div className="mt-3 flex flex-col gap-4">
            {!closed && (
              <details className="rounded-xl bg-canvas p-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink">Quick start: fill Monday to Friday</summary>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <Input id="q-start" type="time" label="First bell" value={quick.start} onChange={(e) => setQuick({ ...quick, start: e.target.value })} />
                  <Input id="q-len" type="number" min={20} max={90} label="Lesson (minutes)" value={quick.lesson} onChange={(e) => setQuick({ ...quick, lesson: Number(e.target.value) })} />
                  <Input id="q-before" type="number" min={1} max={6} label="Lessons before tea" value={quick.before} onChange={(e) => setQuick({ ...quick, before: Number(e.target.value) })} />
                  <Input id="q-brk" type="number" min={0} max={60} label="Tea (minutes)" value={quick.brk} onChange={(e) => setQuick({ ...quick, brk: Number(e.target.value) })} />
                  <Input id="q-after" type="number" min={0} max={6} label="Lessons after tea" value={quick.after} onChange={(e) => setQuick({ ...quick, after: Number(e.target.value) })} />
                </div>
                <Button className="mt-3" variant="secondary" onClick={() => setDays(Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, generate(quick)])))}>Fill the week</Button>
              </details>
            )}
            {dayList.length === 0 && <p className="text-sm text-muted">No periods yet. Use the quick start above, or add a day.</p>}
            {dayList.map((d) => (
              <div key={d} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">{DAY_NAME[d]}</h3>
                  {!closed && (
                    <div className="flex flex-wrap gap-3 text-sm">
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDay(d, renumber([...days[d]!, { periodNo: 0, label: '', start: days[d]!.at(-1)?.end ?? '07:30', end: toHm(toMin(days[d]!.at(-1)?.end ?? '07:30') + 35), type: 'LESSON' }]))}>Add period</button>
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setDays(Object.fromEntries(dayList.map((x) => [x, x === d ? days[x]! : x <= 5 && d <= 5 ? days[d]!.map((p) => ({ ...p, id: undefined })) : days[x]!])))}>Copy to the other weekdays</button>
                      <button type="button" className="font-semibold text-danger hover:underline" onClick={() => { const n = { ...days }; delete n[d]; setDays(n); }}>Remove day</button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead><tr><Th>No</Th><Th>Name</Th><Th>Start</Th><Th>End</Th><Th>Type</Th><Th><span className="sr-only">Remove</span></Th></tr></thead>
                    <tbody>
                      {days[d]!.map((p, i) => (
                        <tr key={i} className="border-t border-line">
                          <Td className="tabular-nums text-muted">{p.periodNo}</Td>
                          <Td><input aria-label="Name" disabled={closed} value={p.label} placeholder={p.type === 'LESSON' ? `Period ${p.periodNo}` : 'Tea'} onChange={(e) => setDay(d, days[d]!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="min-h-[40px] w-32 rounded-lg border border-line px-2" /></Td>
                          <Td><input aria-label="Start" type="time" disabled={closed} value={p.start} onChange={(e) => setDay(d, days[d]!.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="min-h-[40px] rounded-lg border border-line px-2" /></Td>
                          <Td><input aria-label="End" type="time" disabled={closed} value={p.end} onChange={(e) => setDay(d, days[d]!.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="min-h-[40px] rounded-lg border border-line px-2" /></Td>
                          <Td><select aria-label="Type" disabled={closed} value={p.type} onChange={(e) => setDay(d, days[d]!.map((x, j) => (j === i ? { ...x, type: e.target.value as P['type'] } : x)))} className="min-h-[40px] rounded-lg border border-line px-2">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Td>
                          <Td>{!closed && <button type="button" aria-label="Remove period" className="text-danger" onClick={() => setDay(d, renumber(days[d]!.filter((_, j) => j !== i)))}>✕</button>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            {!closed && (
              <div className="flex flex-wrap items-center gap-3">
                {[1, 2, 3, 4, 5, 6].filter((d) => !(d in days)).map((d) => <button key={d} type="button" onClick={() => setDays({ ...days, [d]: d === 6 ? [{ periodNo: 1, label: '', start: '08:00', end: '08:40', type: 'LESSON' }] : (days[1] ?? generate(quick)).map((p) => ({ ...p, id: undefined })) })} className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-primary hover:bg-tint">+ {DAY_NAME[d]}</button>)}
              </div>
            )}
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={forTerm} disabled={closed || (inUse && scope !== 'TERM')} onChange={(e) => setForTerm(e.target.checked)} />This schedule is for {term.name} only (otherwise it is the school&apos;s schedule for every term)</label>
            {!closed && <div><Button onClick={saveBell} loading={busy}>Save bell schedule</Button></div>}
            {hasTermSchedule && !forTerm && <Notice tone="warn">{term.name} has its own schedule, so the school schedule you are saving will not apply to it.</Notice>}
          </div>
        </Section>
      )}

      {tab === 'rooms' && (
        <Section title="Rooms" hint="Classrooms, laboratories, computer labs, workshops, halls and fields." action={<Button onClick={() => setRoom({ id: null, name: '', type: 'CLASSROOM', capacity: '45', active: true })}>Add room</Button>}>
          <ul className="divide-y divide-line">
            {rooms.length === 0 && <li className="py-6 text-center text-sm text-muted">No rooms yet.</li>}
            {rooms.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span><b className="text-ink">{r.name}</b> <span className="text-sm text-muted">· {ROOM_TYPES.find((t) => t.value === r.type)?.label} · holds {r.capacity}{r.active ? '' : ' · not in use'}{r.lessons ? ` · ${r.lessons} lessons` : ''}</span></span>
                <span className="flex gap-3 text-sm">
                  <button type="button" onClick={() => setRoom({ id: r.id, name: r.name, type: r.type, capacity: String(r.capacity), active: r.active })} className="font-semibold text-primary hover:underline">Edit</button>
                  <button type="button" onClick={() => deleteRoom(r)} className="font-semibold text-danger hover:underline">Delete</button>
                </span>
              </li>
            ))}
          </ul>
          <Modal open={!!room} onClose={() => setRoom(null)} title={room?.id ? 'Edit room' : 'Add room'} footer={<><Button variant="secondary" onClick={() => setRoom(null)}>Cancel</Button><Button onClick={saveRoom} loading={busy}>Save</Button></>}>
            {room && (
              <div className="flex flex-col gap-3">
                <Input id="r-name" label="Name" value={room.name} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
                <Select id="r-type" label="Type" value={room.type} onChange={(e) => setRoom({ ...room, type: e.target.value })} options={ROOM_TYPES} />
                <Input id="r-cap" type="number" min={1} label="Capacity" value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} />
                <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={room.active} onChange={(e) => setRoom({ ...room, active: e.target.checked })} />In use</label>
              </div>
            )}
          </Modal>
        </Section>
      )}

      {tab === 'availability' && (
        <Section title="Teacher availability" hint="Periods a teacher cannot teach (part-time staff, a free day). Placing a lesson there still works but shows a warning.">
          <div className="mb-3 max-w-xs">
            <Select id="av-teacher" label="Teacher" value={selectedTeacher ?? ''} placeholder="Choose a teacher" options={teachers.map((t) => ({ value: t.id, label: t.fullName }))} onChange={(e) => router.push(e.target.value ? `?tab=availability&teacherId=${e.target.value}` : '?tab=availability')} />
          </div>
          {selectedTeacher && (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead><tr><Th>Period</Th>{[1, 2, 3, 4, 5, 6].filter((d) => periodsForAvailability.some((p) => p.dayOfWeek === d)).map((d) => <Th key={d}>{DAY_SHORT[d]}</Th>)}</tr></thead>
                  <tbody>
                    {availRows.map((no) => (
                      <tr key={no} className="border-t border-line">
                        <Td className="text-muted">{no}</Td>
                        {[1, 2, 3, 4, 5, 6].filter((d) => periodsForAvailability.some((p) => p.dayOfWeek === d)).map((d) => {
                          const p = periodsForAvailability.find((x) => x.dayOfWeek === d && x.periodNo === no && x.type === 'LESSON');
                          return <Td key={d}>{p ? <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={off.includes(p.id)} onChange={(e) => setOff(e.target.checked ? [...off, p.id] : off.filter((x) => x !== p.id))} aria-label={`${DAY_SHORT[d]} period ${no} unavailable`} /><span className="text-xs text-muted">{p.start}</span></label> : <span className="text-muted/40">—</span>}</Td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">Tick the periods the teacher cannot teach.</p>
              {!closed && <Button className="mt-3" onClick={saveAvailability} loading={busy}>Save availability</Button>}
            </>
          )}
        </Section>
      )}
    </div>
  );
}
