'use client';

// Recording an exeat, a general exeat list from the Calendar, and the visitor log: forms for the boarding master's desk.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

const TYPES = [['WEEKEND', 'Weekend'], ['LONG', 'Long'], ['MEDICAL', 'Medical'], ['EMERGENCY', 'Emergency'], ['SCHOOL_ACTIVITY', 'School activity']] as const;
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ExeatRequestForm({ canApprove }: { canApprove: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Learner | null>(null);
  const [type, setType] = useState('WEEKEND');
  const [out, setOut] = useState(local(new Date()));
  const [back, setBack] = useState(local(new Date(Date.now() + 2 * 86_400_000)));
  const [reason, setReason] = useState('');
  const [approveNow, setApproveNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!s) { setError('Choose the learner'); return; }
    setBusy(true); setError(null);
    const r = await api('/api/facilities/exeats', 'POST', { studentId: s.id, type, outAt: new Date(out).toISOString(), dueBackAt: new Date(back).toISOString(), reason, approveNow: approveNow || undefined });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(r.body.data?.needsHead ? 'Sent to the Head to approve' : 'Exeat recorded');
    setS(null); setReason('');
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <LearnerPicker id="ex-learner" value={s} onChange={setS} boardersOnly />
      <select aria-label="Type" className={fieldClass} value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <label className="text-xs text-muted">Leaves<input type="datetime-local" className={fieldClass} value={out} onChange={(e) => setOut(e.target.value)} /></label>
      <label className="text-xs text-muted">Due back<input type="datetime-local" className={fieldClass} value={back} onChange={(e) => setBack(e.target.value)} /></label>
      <input aria-label="Reason" className={fieldClass} placeholder="Reason (who asked, and why)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {canApprove && type !== 'LONG' && type !== 'EMERGENCY' && <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} />Approve now (the guardian has confirmed)</label>}
      {(type === 'LONG' || type === 'EMERGENCY') && <p className="text-xs text-muted">The Head approves this type.</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void save()}>Record exeat</Button>
    </div>
  );
}

export interface BulkProps { hostels: { id: string; name: string }[]; events: { id: string; title: string; startDate: string; endDate: string }[] }
export function BulkExeatForm({ hostels, events }: BulkProps) {
  const router = useRouter();
  const [hostelId, setHostel] = useState(hostels[0]?.id ?? '');
  const [eventId, setEvent] = useState(events[0]?.id ?? '');
  const [preview, setPreview] = useState<{ learners: unknown[]; skipped: { student: string; why: string }[]; type: string; needsHead: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(apply: boolean) {
    setBusy(true); setError(null);
    const r = await api('/api/facilities/exeats/bulk', 'POST', { hostelId, calendarEventId: eventId, apply });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    if (apply) { toast.success('Exeat list created'); setPreview(null); router.refresh(); } else setPreview(r.body.data);
  }
  if (hostels.length === 0 || events.length === 0) return <p className="text-sm text-muted">Set an exeat weekend on the Calendar to make a list from it.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <select aria-label="Hostel" className={fieldClass} value={hostelId} onChange={(e) => { setHostel(e.target.value); setPreview(null); }}>{hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
      <select aria-label="Calendar event" className={fieldClass} value={eventId} onChange={(e) => { setEvent(e.target.value); setPreview(null); }}>{events.map((e) => <option key={e.id} value={e.id}>{e.title} ({e.startDate} to {e.endDate})</option>)}</select>
      {error && <Notice tone="danger">{error}</Notice>}
      {preview && <Notice tone="info">{preview.learners.length} boarders will be put on a {preview.type.toLowerCase()} exeat{preview.needsHead ? ' for the Head to approve' : ' and approved'}.{preview.skipped.length ? ` Skipped: ${preview.skipped.map((k) => k.student).join(', ')}.` : ''}</Notice>}
      <div className="flex gap-2"><Button variant="secondary" className="min-h-[48px]" loading={busy} onClick={() => void run(false)}>Preview</Button>{preview && preview.learners.length > 0 && <Button className="min-h-[48px]" loading={busy} onClick={() => void run(true)}>Create list</Button>}</div>
    </div>
  );
}

export function VisitorForm({ canApproveOthers }: { canApproveOthers: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Learner | null>(null);
  const [name, setName] = useState('');
  const [idNumber, setId] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!s) { setError('Choose the learner'); return; }
    setBusy(true); setError(null);
    const r = await api('/api/facilities/exeats/visitors', 'POST', { studentId: s.id, visitorName: name, idNumber: idNumber || undefined, phone: phone || undefined });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Visitor logged'); setS(null); setName(''); setId(''); setPhone('');
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <LearnerPicker id="vis-learner" value={s} onChange={setS} boardersOnly />
      <input aria-label="Visitor name" className={fieldClass} placeholder="Visitor's full name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Visitor ID number" className={fieldClass} placeholder="ID number" value={idNumber} onChange={(e) => setId(e.target.value)} />
      <input aria-label="Visitor phone" className={fieldClass} inputMode="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <p className="text-xs text-muted">{canApproveOthers ? 'You are approving this visitor as the boarding master.' : 'Only the boarding master can log a visitor who is not a guardian on record.'}</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void save()}>Log visit</Button>
    </div>
  );
}
