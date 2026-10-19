'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { ProfileHeader } from '@/lib/students/profile';
import { IncidentModal, LeavingModal, MoveClassModal, type ClassOption } from '@/components/students/actions';
import { api, Avatar, BoardingBadge, problem, StatusBadge, useBusy } from '@/components/students/shared';

const ALERT_STYLE: Record<string, string> = {
  medical: 'border-danger/40 bg-danger-bg text-danger',
  suspension: 'border-warn/40 bg-warn-bg text-warn',
  'special-needs': 'border-[#93c5fd] bg-[#dbeafe] text-[#1d4ed8]',
  custody: 'border-warn/40 bg-warn-bg text-warn',
};

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());

export function HeaderClient({ header: h, classes }: { header: ProfileHeader; classes: ClassOption[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<null | 'move' | 'incident' | 'leave' | 'letter' | 'rejoin'>(null);
  const student = { id: h.id, fullName: h.fullName, className: h.className, admissionNumber: h.admissionNumber };
  const refresh = () => router.refresh();
  const button = 'inline-flex min-h-[44px] items-center justify-center rounded-full px-4 text-sm font-semibold';
  const a = h.actions;

  return (
    <header className="rounded-2xl bg-white p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar name={h.fullName} src={h.photoUrl} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-bold leading-tight text-ink">{h.fullName}{h.preferredName && <span className="ml-2 text-base font-normal text-muted">“{h.preferredName}”</span>}</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono">{h.admissionNumber}</span> · {h.className ?? 'No class'}{h.houseName ? ` · ${h.houseName} house` : ''}{h.age !== null ? ` · ${h.age} years` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={h.status} /><BoardingBadge boarding={h.boarding} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {a.edit && <Link href={`/students/${h.id}/edit`} className={cn(button, 'border border-primary bg-white text-primary hover:bg-tint')}>Edit</Link>}
          {a.moveClass && <Button variant="secondary" onClick={() => setModal('move')}>Move class</Button>}
          {a.recordIncident && <Button variant="secondary" onClick={() => setModal('incident')}>Record incident</Button>}
          {a.print && <a href={`/api/students/${h.id}/print`} target="_blank" rel="noreferrer" className={cn(button, 'border border-primary bg-white text-primary hover:bg-tint')}>Print</a>}
          {(a.startLeaving || a.regenerateAdmissionLetter || a.rejoin) && (
            <details className="relative">
              <summary className={cn(button, 'cursor-pointer list-none border border-line bg-white text-ink hover:bg-tint')}>More ▾</summary>
              <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
                {a.startLeaving && <button type="button" onClick={() => setModal('leave')} className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-danger hover:bg-tint">Start leaving process</button>}
                {a.regenerateAdmissionLetter && <button type="button" onClick={() => setModal('letter')} className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ink hover:bg-tint">Regenerate admission letter</button>}
                {a.rejoin && <button type="button" onClick={() => setModal('rejoin')} className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-ink hover:bg-tint">Re-admit on this record</button>}
              </div>
            </details>
          )}
        </div>
      </div>

      {h.alerts.length > 0 && (
        <ul aria-label="Alerts" className="mt-4 flex flex-col gap-1.5">
          {h.alerts.map((al, i) => (
            <li key={i} role="note" className={cn('rounded-xl border px-3 py-2 text-sm font-medium', ALERT_STYLE[al.kind])}>{al.text}</li>
          ))}
        </ul>
      )}

      <MoveClassModal open={modal === 'move'} students={[student]} classes={classes} onClose={() => setModal(null)} onDone={refresh} />
      {modal === 'incident' && <IncidentModal open initial={[student]} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'leave' && <LeavingModal open student={student} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'letter' && <LetterModal studentId={h.id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'rejoin' && <RejoinModal studentId={h.id} classes={classes} onClose={() => setModal(null)} onDone={refresh} />}
    </header>
  );
}

function LetterModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  async function submit() {
    const r = await run(() => api(`/api/students/${studentId}/letters`, 'POST', { type: 'LETTER_ADMISSION', reportingDate: date }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(`Admission letter ${r.body.data.referenceNo} saved to Documents`);
    onDone();
    onClose();
  }
  return (
    <Modal open onClose={onClose} title="Regenerate admission letter" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!date}>Make letter</Button></>}>
      <Input id="rd" type="date" label="Reporting date" required value={date} onChange={(e) => setDate(e.target.value)} error={error} />
      <p className="mt-2 text-xs text-muted">The letter is filed on the Documents tab with its own reference number.</p>
    </Modal>
  );
}

function RejoinModal({ studentId, classes, onClose, onDone }: { studentId: string; classes: ClassOption[]; onClose: () => void; onDone: () => void }) {
  const [classId, setClassId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  async function submit(ack = false) {
    const r = await run(() => api(`/api/students/${studentId}/rejoin`, 'POST', { classId, note: note || undefined, acknowledgeFull: ack }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Re-admitted on the old record');
    onDone();
    onClose();
  }
  return (
    <Modal open onClose={onClose} title="Re-admit on this record" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => submit(error.includes('Confirm that you want to go ahead'))} loading={busy} disabled={!classId}>{error.includes('Confirm that you want') ? 'Go ahead anyway' : 'Re-admit'}</Button></>}>
      <p className="mb-3 text-sm text-muted">The student keeps the same admission number and the whole history.</p>
      <Select id="rj-class" label="Class" required placeholder="Choose a class" value={classId} onChange={(e) => { setClassId(e.target.value); setError(''); }} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      <div className="mt-3"><Input id="rj-note" label="Note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="sr-only">{today()}</p>
    </Modal>
  );
}
