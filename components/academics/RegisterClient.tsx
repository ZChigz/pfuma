'use client';

// The register on a phone. Everyone starts Present; the teacher taps only the exceptions. "Mark all present" and "Save register"
// stay at the bottom of the screen. The register is saved on the phone first (IndexedDB) and sent when there is signal, so it
// works on poor connections; "3 registers waiting to sync" shows what is still to be sent.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { ClosedNotice, Notice } from '@/components/academics/shared';
import {
  deviceId, idbStore, nowHm, queueRegister, registerRef, sheetKey, syncQueue, waitingText,
  type DraftEntry, type MarkStatus, type QueuedRegister, type Store,
} from '@/lib/academics/offline';

export interface SheetStudent { id: string; fullName: string; admissionNumber: string; photoUrl: string | null; gender: string | null; status: MarkStatus; reason: string | null; arrivalTime: string | null; locked: boolean }
export interface Sheet {
  kind: 'DAILY' | 'LESSON'; classId: string | null; className: string; slotId: string | null; lesson: string | null; date: string; dateLabel: string; session: 'AM' | 'PM' | 'LESSON'; sessions: string[];
  term: { id: string; name: string; status: string }; schoolDay: boolean; noSchoolReason: string | null; editMode: 'FREE' | 'REASON' | 'DEPUTY' | 'LOCKED'; editMessage: string | null; canMark: boolean;
  register: { markedBy: string; markedAt: string; changedAt: string } | null; students: SheetStudent[];
}

const LABEL: Record<MarkStatus, string> = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused', SUSPENDED: 'Suspended', EXEAT: 'On exeat', SICK_BAY: 'In sick bay' };
const TONE: Record<MarkStatus, string> = {
  PRESENT: 'bg-success-bg text-success', LATE: 'bg-warn-bg text-warn', ABSENT: 'bg-danger-bg text-danger', EXCUSED: 'bg-[#dbeafe] text-[#1d4ed8]', SUSPENDED: 'bg-canvas text-muted', EXEAT: 'bg-canvas text-muted', SICK_BAY: 'bg-canvas text-muted',
};
const REASONS = [['SICK', 'Sick'], ['FAMILY', 'Family'], ['SCHOOL_ACTIVITY', 'School activity'], ['OTHER', 'Other']] as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

async function post(body: { registers: unknown[] }) {
  const res = await fetch('/api/academics/attendance/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

export function RegisterClient({ sheet: initial }: { sheet: Sheet }) {
  const router = useRouter();
  const storeRef = useRef<Store | null>(null);
  const sheet = initial;
  const [marks, setMarks] = useState<Record<string, DraftEntry>>(() => Object.fromEntries(initial.students.map((s) => [s.id, { studentId: s.id, status: s.status, reason: s.reason, arrivalTime: s.arrivalTime }])));
  const [open, setOpen] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedRegister[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState('');
  const key = sheetKey(sheet.kind === 'DAILY' ? 'DAILY' : 'LESSON', (sheet.kind === 'DAILY' ? sheet.classId : sheet.slotId) ?? '', sheet.date, sheet.session === 'LESSON' ? undefined : sheet.session);
  const editable = sheet.canMark && sheet.schoolDay;

  const store = useCallback(() => (storeRef.current ??= idbStore()), []);
  const refreshQueue = useCallback(async () => { try { setQueue(await store().allQueued()); } catch { /* storage unavailable */ } }, [store]);

  const sendQueue = useCallback(async (quiet = false) => {
    try {
      const s = await syncQueue(store(), post);
      setOnline(!s.offline);
      await refreshQueue();
      if (!quiet && s.saved) toast.success(s.saved === 1 ? 'Register sent' : `${s.saved} registers sent`);
      if (s.refused) toast.error('The school could not accept a register. See the note on this page.');
      return s;
    } catch { return null; }
  }, [store, refreshQueue]);

  // On first load: keep a copy of the sheet for offline opening, show anything saved on this phone for it, and send what is waiting.
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    setOnline(navigator.onLine);
    (async () => {
      try {
        await store().putSheet(key, initial);
        const mine = await store().getQueued(key);
        if (mine && mine.state === 'PENDING') {
          setMarks((m) => ({ ...m, ...Object.fromEntries(mine.entries.map((e) => [e.studentId, e])) }));
          setDirty(true);
        }
      } catch { /* the page still works without storage */ }
      await refreshQueue();
      void sendQueue(true);
    })();
    const on = () => { setOnline(true); void sendQueue(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const timer = setInterval(() => { if (navigator.onLine) void sendQueue(true); }, 60_000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, SUSPENDED: 0, EXEAT: 0, SICK_BAY: 0 } as Record<MarkStatus, number>;
    for (const s of sheet.students) c[marks[s.id]?.status ?? s.status]++;
    return c;
  }, [marks, sheet.students]);

  function set(s: SheetStudent, patch: Partial<DraftEntry>) {
    if (!editable || s.locked) return;
    setMarks((m) => ({ ...m, [s.id]: { ...m[s.id]!, studentId: s.id, ...patch } }));
    setDirty(true);
  }
  function choose(s: SheetStudent, status: MarkStatus) {
    if (status === 'LATE') set(s, { status, arrivalTime: marks[s.id]?.arrivalTime ?? nowHm(), reason: null });
    else if (status === 'EXCUSED') set(s, { status, reason: marks[s.id]?.reason ?? 'SICK', arrivalTime: null });
    else if (status === 'ABSENT') set(s, { status, arrivalTime: null, reason: null });
    else set(s, { status, reason: null, arrivalTime: null });
    if (status === 'PRESENT' || status === 'ABSENT') setOpen(null);
  }
  function allPresent() {
    setMarks((m) => Object.fromEntries(sheet.students.map((s) => [s.id, s.locked ? m[s.id]! : { studentId: s.id, status: 'PRESENT' as MarkStatus, reason: null, arrivalTime: null }])));
    setDirty(true);
    setOpen(null);
  }

  async function save() {
    if (!editable) return;
    if (sheet.editMode === 'REASON' && reason.trim().length < 3) return toast.error('Give a reason for changing this register.');
    setBusy(true);
    const entries: DraftEntry[] = sheet.students.filter((s) => !s.locked).map((s) => marks[s.id]!).filter((e) => e.status !== 'PRESENT');
    const item = await queueRegister(store(), {
      kind: sheet.kind, classId: sheet.classId ?? undefined, slotId: sheet.slotId ?? undefined, date: sheet.date, session: sheet.session === 'LESSON' ? undefined : sheet.session,
      entries, changedAt: new Date().toISOString(), deviceId: deviceId(), correctionReason: sheet.editMode === 'REASON' ? reason.trim() : undefined,
      label: sheet.kind === 'DAILY' ? sheet.className : sheet.lesson ?? sheet.className,
    }).catch(() => null);
    if (!item) { setBusy(false); return toast.error('This phone could not keep the register. Check its storage and try again.'); }
    await refreshQueue();
    const s = await sendQueue(true);
    setBusy(false);
    const still = await store().getQueued(item.ref);
    if (!still) {
      setDirty(false);
      toast.success(s?.keptNewer ? 'A newer version of this register was already saved.' : 'Register saved');
      router.refresh();
    } else if (still.state === 'FAILED') {
      toast.error(still.message ?? 'The register was not accepted.');
    } else {
      toast.info('Saved on this phone. It will be sent when the signal returns.');
    }
  }

  const pending = queue.filter((q) => q.state === 'PENDING');
  const refused = queue.filter((q) => q.state === 'FAILED');
  const here = queue.find((q) => q.ref === registerRef(sheet.kind, (sheet.kind === 'DAILY' ? sheet.classId : sheet.slotId) ?? '', sheet.date, sheet.session === 'LESSON' ? undefined : sheet.session));

  return (
    <div className="flex flex-col gap-3 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-ink">{sheet.kind === 'DAILY' ? sheet.className : sheet.lesson}</h2>
          <p className="text-sm text-muted">{sheet.dateLabel}{sheet.kind === 'DAILY' && (sheet.session === 'AM' ? ' · Morning' : ' · Afternoon')} · {sheet.term.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', online ? 'bg-success-bg text-success' : 'bg-warn-bg text-warn')}>
            <span className={cn('h-2 w-2 rounded-full', online ? 'bg-success' : 'bg-warn')} aria-hidden="true" />{online ? 'Online' : 'Offline: marks are kept on this phone'}
          </span>
          {pending.length > 0 && (
            <button type="button" onClick={() => sendQueue()} className="rounded-full bg-gold/20 px-3 py-1 text-xs font-bold text-warn" aria-label={`${waitingText(pending.length)}. Tap to send now.`}>{waitingText(pending.length)}</button>
          )}
        </div>
      </div>

      {sheet.term.status === 'CLOSED' && <ClosedNotice termName={sheet.term.name} />}
      {!sheet.schoolDay && <Notice tone="info">{sheet.noSchoolReason ?? 'There is no register on this day.'}</Notice>}
      {sheet.schoolDay && sheet.editMessage && <Notice tone={sheet.editMode === 'FREE' ? 'info' : 'warn'}>{sheet.editMessage}</Notice>}
      {sheet.register && <p className="text-xs text-muted">Marked by {sheet.register.markedBy} at {new Date(sheet.register.markedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</p>}
      {here?.state === 'FAILED' && <Notice tone="danger"><b>This register was not accepted:</b> {here.message} Fix it and save again.</Notice>}
      {refused.filter((r) => r !== here).map((r) => <Notice key={r.ref} tone="danger"><b>{r.label}, {r.date} was not accepted:</b> {r.message}</Notice>)}
      {here?.state === 'PENDING' && !dirty && <Notice tone="info">This register is saved on this phone and waiting to be sent.</Notice>}

      {sheet.schoolDay && (
        <>
          <div className="grid grid-cols-4 gap-2 text-center text-xs" aria-live="polite">
            {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((k) => (
              <div key={k} className={cn('rounded-xl px-2 py-2', TONE[k])}><p className="text-xl font-bold tabular-nums">{counts[k]}</p><p>{LABEL[k]}</p></div>
            ))}
          </div>

          {sheet.editMode === 'REASON' && editable && (
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">Reason for the change
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: forgot to mark yesterday" className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm" />
            </label>
          )}

          <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-white">
            {sheet.students.map((s, i) => {
              const m = marks[s.id] ?? { studentId: s.id, status: s.status };
              const isOpen = open === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button" disabled={!editable || s.locked} onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                    className="flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-default"
                  >
                    <span className="w-6 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                    {s.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.photoUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden="true" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold text-primary">{initials(s.fullName)}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{s.fullName}</span>
                      {m.status === 'LATE' && m.arrivalTime && <span className="text-xs text-muted">Arrived {m.arrivalTime}</span>}
                      {m.status === 'EXCUSED' && m.reason && <span className="text-xs text-muted">{REASONS.find((r) => r[0] === m.reason)?.[1]}</span>}
                      {s.locked && <span className="text-xs text-muted">Filled in automatically</span>}
                    </span>
                    <span className={cn('flex-shrink-0 rounded-full px-3 py-1 text-xs font-bold', TONE[m.status])}>{LABEL[m.status]}</span>
                  </button>
                  {isOpen && editable && (
                    <div className="flex flex-col gap-2 bg-canvas px-3 py-3">
                      <div className="grid grid-cols-4 gap-2">
                        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const).map((k) => (
                          <button key={k} type="button" onClick={() => choose(s, k)} aria-pressed={m.status === k} className={cn('min-h-[48px] rounded-xl px-1 text-sm font-bold', m.status === k ? 'ring-2 ring-ink' : 'ring-1 ring-line', TONE[k])}>{LABEL[k]}</button>
                        ))}
                      </div>
                      {m.status === 'LATE' && (
                        <label className="flex items-center gap-3 text-sm font-medium text-ink">Arrived at
                          <input type="time" value={m.arrivalTime ?? ''} onChange={(e) => set(s, { arrivalTime: e.target.value })} className="min-h-[44px] rounded-xl border border-line bg-white px-3" />
                          <button type="button" onClick={() => setOpen(null)} className="ml-auto rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">Done</button>
                        </label>
                      )}
                      {m.status === 'EXCUSED' && (
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
                          {REASONS.map(([v, label]) => (
                            <button key={v} type="button" onClick={() => { set(s, { reason: v }); setOpen(null); }} aria-pressed={m.reason === v} className={cn('min-h-[44px] rounded-full px-4 text-sm font-semibold', m.reason === v ? 'bg-primary text-white' : 'bg-white ring-1 ring-line')}>{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {sheet.students.length === 0 && <li className="p-6 text-center text-sm text-muted">No students are enrolled in this class this term.</li>}
          </ul>
        </>
      )}

      {sheet.schoolDay && editable && sheet.students.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-3 border-t border-line bg-white p-3 shadow-[0_-8px_24px_-12px_rgba(20,48,31,0.3)] md:absolute md:rounded-b-2xl" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <Button variant="secondary" className="flex-1" onClick={allPresent}>Mark all present</Button>
          <Button className="flex-1" onClick={save} loading={busy} disabled={!dirty && !!sheet.register}>Save register</Button>
        </div>
      )}
      {sheet.schoolDay && !editable && sheet.students.length > 0 && (
        <p className="text-center text-sm text-muted">{sheet.canMark ? '' : 'You can look at this register but not change it.'} <Link href="/academics/attendance" className="font-semibold text-primary">Back to registers</Link></p>
      )}
    </div>
  );
}
