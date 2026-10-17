'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { IncidentModal, type PickedStudent } from '@/components/students/actions';
import { api, fieldMessages, FormGrid, formatDay, formatWhen, problem, Section, TextArea, useBusy } from '@/components/students/shared';

export interface IncidentView {
  id: string; occurredAt: string; location: string; category: string; severity: string; description: string; witnesses: string | null; recordedBy: string; alsoInvolved: string[];
  actions: { id: string; type: string; status: string; startDate: string | null; endDate: string | null; notes: string | null; decision: string | null; decisionDate: string | null; authorityRef: string | null; meeting: { date: string | null; attendees: string | null; outcome: string | null; hasLetter: boolean } | null }[];
}

const LABEL: Record<string, string> = {
  LATE_COMING: 'Late coming', ABSENT_WITHOUT_LEAVE: 'Absent without leave', UNIFORM: 'Uniform', HOMEWORK: 'Homework', DISRESPECT: 'Disrespect', BULLYING: 'Bullying', FIGHTING: 'Fighting',
  THEFT: 'Theft', VANDALISM: 'Vandalism', SUBSTANCE_USE: 'Substance use', PHONE_USE: 'Phone use', ABSCONDING: 'Absconding / out of bounds', EXAM_DISHONESTY: 'Exam dishonesty', OTHER: 'Other',
  CLASSROOM: 'Classroom', DORMITORY: 'Dormitory', SPORTS_FIELD: 'Sports field', DINING_HALL: 'Dining hall', OFF_CAMPUS: 'Off campus',
  VERBAL_WARNING: 'Verbal warning', WRITTEN_WARNING: 'Written warning', DETENTION: 'Detention', MANUAL_WORK: 'Manual work', COUNSELLING_REFERRAL: 'Counselling referral',
  GUARDIAN_CALLED_IN: 'Guardian called in', SUSPENSION: 'Suspension', EXPULSION_RECOMMENDED: 'Expulsion recommended',
};
const SEVERITY: Record<string, BadgeVariant> = { MINOR: 'neutral', MODERATE: 'warning', SERIOUS: 'danger' };
const STATUS: Record<string, BadgeVariant> = { RECORDED: 'neutral', PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', ENDED: 'neutral' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());

export function DisciplineTab({ student, incidents, canRecord, canApprove, canRecordMeeting }: { student: PickedStudent; incidents: IncidentView[]; canRecord: boolean; canApprove: boolean; canRecordMeeting: boolean }) {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [deciding, setDeciding] = useState<{ id: string; type: string } | null>(null);
  const [meeting, setMeeting] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const refresh = () => router.refresh();

  async function decideSuspension(id: string, decision: 'APPROVE' | 'REJECT') {
    const r = await run(() => api(`/api/students/discipline/actions/${id}`, 'POST', { decision }));
    if (r && !r.ok) toast.error(problem(r)); else { toast.success(decision === 'APPROVE' ? 'Suspension approved' : 'Suspension declined'); refresh(); }
  }

  return (
    <Section title={`Incidents (${incidents.length})`} action={canRecord && <Button size="sm" onClick={() => setRecording(true)}>Record incident</Button>}>
      {incidents.length === 0 ? <p className="text-sm text-muted">No incidents recorded. Newest appear first.</p> : (
        <ul className="flex flex-col gap-3">
          {incidents.map((i) => (
            <li key={i.id} className="rounded-xl border border-line p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink">{LABEL[i.category] ?? i.category}</p>
                <Badge variant={SEVERITY[i.severity] ?? 'neutral'} label={i.severity.charAt(0) + i.severity.slice(1).toLowerCase()} />
                <span className="text-xs text-muted">{formatWhen(i.occurredAt)} · {LABEL[i.location] ?? i.location} · recorded by {i.recordedBy}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{i.description}</p>
              {i.witnesses && <p className="mt-1 text-xs text-muted">Witnesses: {i.witnesses}</p>}
              {i.alsoInvolved.length > 0 && <p className="mt-1 text-xs text-muted">Also involved: {i.alsoInvolved.join(', ')}</p>}
              {i.actions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
                  {i.actions.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{LABEL[a.type] ?? a.type}</span><Badge variant={STATUS[a.status] ?? 'neutral'} label={a.status.toLowerCase()} />
                        {a.startDate && <span className="text-xs text-muted">{formatDay(a.startDate)} to {formatDay(a.endDate)}</span>}
                      </div>
                      {a.notes && <p className="text-xs text-muted">{a.notes}</p>}
                      {a.decision && <p className="text-xs text-muted">Decision: {a.decision.toLowerCase()} on {formatDay(a.decisionDate)}{a.authorityRef ? ` · reference ${a.authorityRef}` : ''}</p>}
                      {a.meeting?.date && <p className="text-xs text-muted">Meeting {formatDay(a.meeting.date)} with {a.meeting.attendees}: {a.meeting.outcome}{a.meeting.hasLetter ? ' (signed letter on file)' : ''}</p>}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {a.status === 'PENDING' && canApprove && a.type === 'SUSPENSION' && (<>
                          <Button size="sm" disabled={busy} onClick={() => decideSuspension(a.id, 'APPROVE')}>Approve suspension</Button>
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => decideSuspension(a.id, 'REJECT')}>Decline</Button>
                        </>)}
                        {a.status === 'PENDING' && canApprove && a.type === 'EXPULSION_RECOMMENDED' && <Button size="sm" onClick={() => setDeciding({ id: a.id, type: a.type })}>Record the decision</Button>}
                        {a.status === 'PENDING' && !canApprove && <span className="text-xs text-warn">Waiting for the Head</span>}
                        {a.type === 'GUARDIAN_CALLED_IN' && canRecordMeeting && <Button size="sm" variant="secondary" onClick={() => setMeeting(a.id)}>{a.meeting?.date ? 'Update meeting' : 'Record meeting'}</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {recording && <IncidentModal open initial={[student]} onClose={() => setRecording(false)} onDone={refresh} />}
      {deciding && <ExpulsionModal id={deciding.id} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); refresh(); }} />}
      {meeting && <MeetingModal id={meeting} onClose={() => setMeeting(null)} onDone={() => { setMeeting(null); refresh(); }} />}
    </Section>
  );
}

export function ExpulsionModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [decision, setDecision] = useState<'CONFIRM_EXPULSION' | 'DECLINE_EXPULSION'>('CONFIRM_EXPULSION');
  const [date, setDate] = useState(today());
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  async function submit() {
    const r = await run(() => api(`/api/students/discipline/actions/${id}`, 'POST', { decision, decisionDate: date, authorityRef: decision === 'CONFIRM_EXPULSION' ? ref || undefined : undefined, notes: notes || undefined }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success(decision === 'CONFIRM_EXPULSION' ? 'Expulsion confirmed. The leaving process has started.' : 'Recommendation declined');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="The Head's decision on the expulsion recommendation" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={decision === 'CONFIRM_EXPULSION' ? 'danger' : 'primary'} onClick={submit} loading={busy}>{decision === 'CONFIRM_EXPULSION' ? 'Confirm expulsion' : 'Decline'}</Button></>}>
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="radio" checked={decision === 'CONFIRM_EXPULSION'} onChange={() => setDecision('CONFIRM_EXPULSION')} /> Confirm the expulsion (starts the leaving process)</label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="radio" checked={decision === 'DECLINE_EXPULSION'} onChange={() => setDecision('DECLINE_EXPULSION')} /> Decline the recommendation</label>
        </fieldset>
        <FormGrid>
          <Input id="x-date" type="date" label="Decision date" required value={date} onChange={(e) => setDate(e.target.value)} error={errors.decisionDate} />
          {decision === 'CONFIRM_EXPULSION' && <Input id="x-ref" label="Approval reference (ministry or responsible authority)" value={ref} onChange={(e) => setRef(e.target.value)} />}
        </FormGrid>
        <TextArea id="x-notes" label="Notes" rows={2} value={notes} onChange={setNotes} />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

function MeetingModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ meetingDate: today(), attendees: '', outcome: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  async function submit() {
    const r = await run(() => api(`/api/students/discipline/actions/${id}/meeting`, 'POST', f));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Meeting recorded');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Guardian meeting" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!f.attendees || !f.outcome}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Input id="m-date" type="date" label="Date" required value={f.meetingDate} onChange={(e) => setF({ ...f, meetingDate: e.target.value })} error={errors.meetingDate} />
        <Input id="m-who" label="Who attended" required value={f.attendees} onChange={(e) => setF({ ...f, attendees: e.target.value })} error={errors.attendees} />
        <TextArea id="m-out" label="Outcome" required rows={3} value={f.outcome} onChange={(v) => setF({ ...f, outcome: v })} error={errors.outcome} />
        <p className="text-xs text-muted">A signed letter can be uploaded on the Documents tab.</p>
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
