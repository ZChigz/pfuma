'use client';

// The rooms and beds of a hostel. Tap a free bed to give it to a boarder (type a name or scan the card); tap a taken bed to move or release
// the learner. A day scholar is changed to a boarder first, after the person confirms, and the boarding charge is added from today.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, Notice, api, fieldClass, problem } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

export interface GridBed { id: string; number: string; bedType: string; locker: string | null; active: boolean; studentId: string | null; student: string | null; className: string | null }
export interface GridRoom { id: string; name: string; floor: string | null; capacity: number; active: boolean; beds: GridBed[] }

export function BedGrid({ rooms, canAllocate }: { rooms: GridRoom[]; canAllocate: boolean }) {
  const router = useRouter();
  const [bed, setBed] = useState<{ room: GridRoom; bed: GridBed } | null>(null);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [needsBoarder, setNeedsBoarder] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function close() { setBed(null); setLearner(null); setNeedsBoarder(null); setReason(''); }

  async function give(changeToBoarder = false) {
    if (!bed || !learner) return;
    setBusy(true);
    const r = await api('/api/facilities/hostel/allocate', 'POST', { studentId: learner.id, bedId: bed.bed.id, ...(changeToBoarder ? { changeToBoarder: true } : {}) });
    setBusy(false);
    if (!r.ok) {
      const msg = problem(r);
      if (/day scholar/i.test(msg) && !changeToBoarder) return setNeedsBoarder(msg);
      return toast.error(msg);
    }
    toast.success(`${learner.name} is in bed ${bed.bed.number}`);
    close();
    router.refresh();
  }

  async function release() {
    if (!bed?.bed.studentId) return;
    setBusy(true);
    const r = await api('/api/facilities/hostel/vacate', 'POST', { studentId: bed.bed.studentId, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Bed released');
    close();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {rooms.map((room) => (
        <section key={room.id} className={`rounded-xl border border-line bg-white p-3 ${room.active ? '' : 'opacity-60'}`}>
          <h3 className="text-sm font-semibold text-ink">{room.name}{room.floor ? <span className="font-normal text-muted"> · {room.floor}</span> : null} <span className="font-normal text-muted">· {room.beds.filter((b) => b.studentId).length} of {room.beds.length} beds</span></h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {room.beds.map((b) => (
              <button key={b.id} type="button" disabled={!canAllocate || !b.active} onClick={() => setBed({ room, bed: b })}
                className={`min-h-[64px] rounded-xl border p-2 text-left text-sm ${b.studentId ? 'border-primary bg-tint' : 'border-dashed border-line bg-canvas'} disabled:cursor-default`} aria-label={`Bed ${b.number} ${b.student ?? 'free'}`}>
                <span className="block text-xs text-muted">Bed {b.number}{b.bedType !== 'SINGLE' ? ` · ${b.bedType === 'BUNK_TOP' ? 'top' : 'bottom'}` : ''}{b.locker ? ` · locker ${b.locker}` : ''}</span>
                <span className="block truncate font-semibold text-ink">{b.student ?? 'Free'}</span>
                {b.className && <span className="block truncate text-xs text-muted">{b.className}</span>}
              </button>
            ))}
            {room.beds.length === 0 && <p className="col-span-full text-sm text-muted">No beds yet.</p>}
          </div>
        </section>
      ))}
      <Modal open={!!bed} onClose={close} title={bed ? `${bed.room.name}, bed ${bed.bed.number}` : ''} size="sm"
        footer={bed?.bed.studentId ? <><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void release()}>Release the bed</Button></>
          : <><Button variant="ghost" onClick={close}>Cancel</Button>{needsBoarder ? <Button loading={busy} onClick={() => void give(true)}>Change to boarder and give the bed</Button> : <Button loading={busy} disabled={!learner} onClick={() => void give()}>Give the bed</Button>}</>}>
        {bed?.bed.studentId ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink"><b>{bed.bed.student}</b> sleeps here. To move them, choose another free bed and give it to them: the history is kept.</p>
            <Field id="bg-why" label="Why is the bed released?"><input id="bg-why" className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example moved to Block B, left the school" /></Field>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field id="bg-learner" label="Boarder"><LearnerPicker id="bg-learner" value={learner} onChange={(l) => { setLearner(l); setNeedsBoarder(null); }} /></Field>
            {learner?.boarding === 'BOARDER' && <p className="text-xs text-muted">{learner.name} is a boarder{learner.className ? ` in ${learner.className}` : ''}. If they already have a bed, it is moved and the old bed stays in their history.</p>}
            {needsBoarder && <Notice tone="warn">{needsBoarder}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  );
}
