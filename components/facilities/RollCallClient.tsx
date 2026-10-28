'use client';

// The hostel roll call on a phone: everyone starts Present, tap only the exceptions (Absent, Late). Learners on exeat, in the sick bay or
// suspended are filled in and locked. It works without signal: the roll call is kept on the phone and sent when there is a connection.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Notice, fieldClass } from '@/components/finance/shared';
import { idbRollStore, queueRollCall, syncRollCalls, waitingRollText, waitingRolls, type RollMark, type QueuedRollCall } from '@/lib/facilities/rollcall-offline';

export interface RollSheetRow { studentId: string; name: string; admissionNumber: string; room: string; bed: string; status: string; locked: boolean; note: string | null }
export interface RollSheet { hostel: { id: string; name: string }; date: string; session: 'MORNING' | 'EVENING' | 'LIGHTS_OUT'; taken: { at: string } | null; rows: RollSheetRow[] }

const LABEL: Record<string, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXEAT: 'On exeat', SICK_BAY: 'In sick bay', SUSPENDED: 'Suspended' };
const TONE: Record<string, string> = { PRESENT: 'bg-success-bg text-success', ABSENT: 'bg-danger-bg text-danger', LATE: 'bg-warn-bg text-warn', EXEAT: 'bg-canvas text-muted', SICK_BAY: 'bg-canvas text-muted', SUSPENDED: 'bg-canvas text-muted' };
const SESSION_NAME = { MORNING: 'Morning', EVENING: 'Evening', LIGHTS_OUT: 'Lights out' } as const;

export function RollCallClient({ sheet, editable }: { sheet: RollSheet; editable: boolean }) {
  const store = useMemo(() => idbRollStore(), []);
  const key = `sheet|${sheet.hostel.id}|${sheet.date}|${sheet.session}`;
  const [marks, setMarks] = useState<Record<string, { status: RollMark; note: string }>>(
    Object.fromEntries(sheet.rows.filter((r) => !r.locked).map((r) => [r.studentId, { status: (r.status === 'ABSENT' || r.status === 'LATE' ? r.status : 'PRESENT') as RollMark, note: r.note ?? '' }])),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [refused, setRefused] = useState<QueuedRollCall[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setWaiting((await waitingRolls(store)).length);
    setRefused((await store.all()).filter((r) => r.state === 'FAILED'));
  }, [store]);

  const send = useCallback(async () => {
    const r = await syncRollCalls(store, async (body) => {
      const res = await fetch('/api/facilities/hostel/rollcall/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    });
    await refresh();
    return r;
  }, [store, refresh]);

  // The sheet is kept on the phone, so a roll call can be opened with no signal; whatever is waiting is sent when the phone is back online.
  useEffect(() => {
    void store.putSheet(key, sheet);
    void refresh();
    const online = () => { void send(); };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [store, key, sheet, refresh, send]);

  const counts = { ABSENT: 0, LATE: 0, away: sheet.rows.filter((r) => r.locked).length };
  for (const m of Object.values(marks)) if (m.status === 'ABSENT' || m.status === 'LATE') counts[m.status]++;

  async function save() {
    setBusy(true);
    const entries = Object.entries(marks).filter(([, m]) => m.status !== 'PRESENT').map(([studentId, m]) => ({ studentId, status: m.status, ...(m.note.trim() ? { note: m.note.trim() } : {}) }));
    await queueRollCall(store, { hostelId: sheet.hostel.id, date: sheet.date, session: sheet.session, entries, clientId: crypto.randomUUID(), label: `${sheet.hostel.name}, ${SESSION_NAME[sheet.session]}` });
    const r = await send();
    setBusy(false);
    if (r.refused > 0) toast.error('The server did not accept this roll call. See the message below.');
    else if (r.waiting > 0) { toast.info('Saved on this phone. It will be sent when there is signal.'); setSaved('phone'); }
    else { toast.success('Roll call saved'); setSaved('server'); }
  }

  const set = (id: string, p: Partial<{ status: RollMark; note: string }>) => setMarks((m) => ({ ...m, [id]: { ...m[id]!, ...p } }));

  return (
    <div className="flex flex-col gap-3 pb-24">
      {waiting > 0 && <button type="button" onClick={() => void send()} className="self-start rounded-full bg-gold/20 px-3 py-2 text-xs font-bold text-warn">{waitingRollText(waiting)}. Tap to send now.</button>}
      {refused.map((r) => <Notice key={r.ref} tone="danger"><b>{r.label}, {r.date} was not accepted:</b> {r.message}</Notice>)}
      {sheet.taken && !saved && <Notice tone="info">This roll call was already taken at {new Date(sheet.taken.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. Saving again replaces it.</Notice>}
      {sheet.session === 'LIGHTS_OUT' && <Notice tone="warn">An Absent at lights out without a reason alerts the boarding master and the Deputy at once.</Notice>}
      <ul className="flex flex-col gap-2">
        {sheet.rows.map((r) => {
          const m = marks[r.studentId];
          const status = r.locked ? r.status : m?.status ?? 'PRESENT';
          const isOpen = open === r.studentId;
          return (
            <li key={r.studentId} className="rounded-xl border border-line bg-white">
              <button type="button" disabled={!editable || r.locked} onClick={() => setOpen(isOpen ? null : r.studentId)} aria-expanded={isOpen} className="flex min-h-[56px] w-full items-center justify-between gap-3 px-3 text-left disabled:cursor-default">
                <span className="min-w-0"><span className="block truncate text-base font-semibold text-ink">{r.name}</span><span className="text-xs text-muted">{r.room ? `${r.room} · bed ${r.bed}` : r.admissionNumber}</span></span>
                <span className={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${TONE[status] ?? ''}`}>{LABEL[status] ?? status}</span>
              </button>
              {r.locked && <p className="px-3 pb-2 text-xs text-muted">Filled in automatically</p>}
              {isOpen && m && (
                <div className="flex flex-col gap-2 border-t border-line p-3">
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Status">
                    {(['PRESENT', 'ABSENT', 'LATE'] as const).map((s) => (
                      <button key={s} type="button" aria-pressed={m.status === s} onClick={() => set(r.studentId, { status: s })} className={`min-h-[52px] rounded-xl text-base font-semibold ${m.status === s ? 'bg-primary text-white' : 'bg-canvas text-ink ring-1 ring-line'}`}>{LABEL[s]}</button>
                    ))}
                  </div>
                  {m.status !== 'PRESENT' && <input aria-label="Reason" className={fieldClass} placeholder="Reason, if you know it" value={m.note} onChange={(e) => set(r.studentId, { note: e.target.value })} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sheet.rows.length === 0 && <p className="text-sm text-muted">Nobody sleeps in this hostel yet.</p>}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-line bg-white p-3">
          <p className="min-w-0 flex-1 text-xs text-muted">{counts.ABSENT} absent · {counts.LATE} late · {counts.away} away</p>
          <Button variant="secondary" className="min-h-[52px]" onClick={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([id]) => [id, { status: 'PRESENT' as RollMark, note: '' }])))}>All present</Button>
          <Button className="min-h-[52px] min-w-[120px]" loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      )}
    </div>
  );
}
