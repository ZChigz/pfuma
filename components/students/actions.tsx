'use client';

// The actions that start from the Students list or from a profile: move class, assign house, record an incident,
// start the leaving process, print class lists. Each one calls the same API the rules live behind; the screen only helps.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, Checkbox, fieldMessages, FormGrid, problem, TextArea, useBusy } from '@/components/students/shared';

export interface ClassOption { id: string; name: string; levelOrder?: number }
export interface HouseOption { id: string; name: string }
export interface PickedStudent { id: string; fullName: string; className?: string | null; admissionNumber?: string }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());

// ─── Move class ──────────────────────────────────────────────────────────────

const MOVE_REASONS = [
  ['WRONG_CLASS_AT_ADMISSION', 'Wrong class at admission'], ['SUBJECT_COMBINATION', 'Subject combination'], ['BEHAVIOUR', 'Behaviour'],
  ['PARENT_REQUEST', 'Parent request'], ['BALANCING_CLASS_SIZES', 'Balancing class sizes'], ['OTHER', 'Other'],
] as const;

interface Preview { mode: 'CORRECTION' | 'MID_TERM'; appliesNow: boolean; className: string; capacity: number; currentSize: number; newSize: number; warnings: { code: string; message: string }[] }

export function MoveClassModal({ students, classes, open, onClose, onDone }: { students: PickedStudent[]; classes: ClassOption[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const [toClassId, setToClassId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const ids = students.map((s) => s.id);

  useEffect(() => { if (open) { setToClassId(''); setReason(''); setNote(''); setDate(today()); setPreview(null); setErrors({}); } }, [open]);

  // As soon as a class is chosen, ask what would happen: the new class size and whether it is full.
  useEffect(() => {
    if (!open || !toClassId || !reason) { setPreview(null); return; }
    let live = true;
    api('/api/students/move', 'POST', { move: { studentIds: ids, toClassId, reason, reasonNote: note || undefined, effectiveDate: date }, dryRun: true }).then((r) => {
      if (!live) return;
      if (r.ok) { setPreview(r.body.data); setErrors({}); } else { setPreview(null); setErrors({ form: problem(r) }); }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, toClassId, reason, date]);

  async function submit() {
    const r = await run(() => api('/api/students/move', 'POST', { move: { studentIds: ids, toClassId, reason, reasonNote: note || undefined, effectiveDate: date, acknowledgeFull: !!preview?.warnings.length } }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success(r.body.data.pending ? `Request sent for approval (${r.body.data.pending})` : `Moved ${r.body.data.applied} to ${r.body.data.className}`);
    onDone();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Move ${students.length === 1 ? students[0]!.fullName : `${students.length} students`} to another class`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!toClassId || !reason}>{preview && !preview.appliesNow ? 'Send for approval' : 'Move'}</Button></>}>
      <div className="flex flex-col gap-3">
        <Select id="mv-class" label="New class" required placeholder="Choose a class" value={toClassId} onChange={(e) => setToClassId(e.target.value)} options={classes.map((c) => ({ value: c.id, label: c.name }))} error={errors.toClassId} />
        <FormGrid>
          <Select id="mv-reason" label="Reason" required placeholder="Choose a reason" value={reason} onChange={(e) => setReason(e.target.value)} options={MOVE_REASONS.map(([value, label]) => ({ value, label }))} error={errors.reason} />
          <Input id="mv-date" type="date" label="Effective date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} error={errors.effectiveDate} />
        </FormGrid>
        {(reason === 'OTHER' || note) && <TextArea id="mv-note" label="Say more" required={reason === 'OTHER'} rows={2} value={note} onChange={setNote} error={errors.reasonNote} />}
        {preview && (
          <div className="rounded-xl bg-canvas p-3 text-sm text-ink">
            <p><strong>{preview.className}</strong> has {preview.currentSize} of {preview.capacity} places taken. After this move it will have <strong>{preview.newSize}</strong>.</p>
            {preview.warnings.map((w) => <p key={w.code} role="alert" className="mt-1.5 font-medium text-warn">{w.message}</p>)}
            <p className="mt-1.5 text-muted">{preview.mode === 'CORRECTION' ? 'The term has not started, so this only corrects the class.' : preview.appliesNow ? 'The term has started. You can approve this, so it happens now and your name is recorded.' : 'The term has started, so the Head must approve this move before it happens.'}</p>
          </div>
        )}
        {!reason && toClassId && <p className="text-xs text-muted">Choose a reason to see the new class size.</p>}
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

// ─── Assign house ────────────────────────────────────────────────────────────

export function AssignHouseModal({ students, houses, open, onClose, onDone }: { students: PickedStudent[]; houses: HouseOption[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const [houseId, setHouseId] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  useEffect(() => { if (open) { setHouseId(''); setError(''); } }, [open]);
  async function submit() {
    const r = await run(() => api('/api/students/house', 'POST', { studentIds: students.map((s) => s.id), houseId: houseId === 'none' ? null : houseId }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    toast.success(r.body.data.houseName ? `${r.body.data.changed} student(s) now in ${r.body.data.houseName}` : `${r.body.data.changed} student(s) taken out of their house`);
    onDone();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title={`Assign a house to ${students.length} student${students.length === 1 ? '' : 's'}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!houseId}>Assign</Button></>}>
      <Select id="house" label="House" placeholder="Choose a house" value={houseId} onChange={(e) => setHouseId(e.target.value)} options={[...houses.map((h) => ({ value: h.id, label: h.name })), { value: 'none', label: 'No house' }]} error={error} />
      {houses.length === 0 && <p className="mt-2 text-xs text-muted">No houses are set up yet. An administrator can add them under School Settings, Students.</p>}
    </Modal>
  );
}

// ─── Print class lists ───────────────────────────────────────────────────────

export function PrintClassListModal({ classes, preselected, open, onClose }: { classes: ClassOption[]; preselected: string[]; open: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [separate, setSeparate] = useState(false);
  useEffect(() => { if (open) { setPicked(preselected); setSeparate(false); } }, [open, preselected]);
  const url = `/api/students/class-list?classIds=${picked.join(',')}&separate=${separate ? 1 : 0}`;
  return (
    <Modal open={open} onClose={onClose} title="Print class lists" size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><a href={picked.length ? url : undefined} target="_blank" rel="noreferrer" aria-disabled={!picked.length} onClick={() => picked.length && onClose()}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover ${picked.length ? '' : 'pointer-events-none opacity-50'}`}>Open PDF</a></>}>
      <p className="mb-2 text-sm text-muted">One A4 page per class, with the class teacher and numbered names in alphabetical order by surname.</p>
      <Checkbox label="List boys and girls separately" checked={separate} onChange={setSeparate} />
      <fieldset className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-line p-2">
        <legend className="px-1 text-xs font-medium text-muted">Classes</legend>
        {classes.map((c) => <Checkbox key={c.id} label={c.name} checked={picked.includes(c.id)} onChange={(v) => setPicked((p) => (v ? [...p, c.id] : p.filter((x) => x !== c.id)))} />)}
      </fieldset>
    </Modal>
  );
}

// ─── Record an incident ──────────────────────────────────────────────────────

const LOCATIONS = [['CLASSROOM', 'Classroom'], ['DORMITORY', 'Dormitory'], ['SPORTS_FIELD', 'Sports field'], ['DINING_HALL', 'Dining hall'], ['OFF_CAMPUS', 'Off campus'], ['OTHER', 'Other']] as const;
const CATEGORIES = [
  ['LATE_COMING', 'Late coming'], ['ABSENT_WITHOUT_LEAVE', 'Absent without leave'], ['UNIFORM', 'Uniform'], ['HOMEWORK', 'Homework'], ['DISRESPECT', 'Disrespect'], ['BULLYING', 'Bullying'],
  ['FIGHTING', 'Fighting'], ['THEFT', 'Theft'], ['VANDALISM', 'Vandalism'], ['SUBSTANCE_USE', 'Substance use'], ['PHONE_USE', 'Phone use'], ['ABSCONDING', 'Absconding / out of bounds'],
  ['EXAM_DISHONESTY', 'Exam dishonesty'], ['OTHER', 'Other'],
] as const;
const SEVERITIES = [['MINOR', 'Minor'], ['MODERATE', 'Moderate'], ['SERIOUS', 'Serious']] as const;
// Corporal punishment is not on this list and never will be: it is prohibited under the Education Amendment Act, 2020.
const ACTIONS = [
  ['VERBAL_WARNING', 'Verbal warning'], ['WRITTEN_WARNING', 'Written warning'], ['DETENTION', 'Detention'], ['MANUAL_WORK', 'Manual work'], ['COUNSELLING_REFERRAL', 'Counselling referral'],
  ['GUARDIAN_CALLED_IN', 'Guardian called in'], ['SUSPENSION', 'Suspension (needs approval)'], ['EXPULSION_RECOMMENDED', 'Expulsion recommended (the Head decides)'],
] as const;

const nowLocal = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Harare' }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function IncidentModal({ initial, open, onClose, onDone }: { initial: PickedStudent[]; open: boolean; onClose: () => void; onDone?: () => void }) {
  const [students, setStudents] = useState<PickedStudent[]>(initial);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PickedStudent[]>([]);
  const [when, setWhen] = useState(nowLocal());
  const [location, setLocation] = useState('CLASSROOM');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('MINOR');
  const [description, setDescription] = useState('');
  const [witnesses, setWitnesses] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [suspension, setSuspension] = useState({ start: today(), end: today() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const { busy, run } = useBusy();

  useEffect(() => {
    if (!open) return;
    setStudents(initial); setQ(''); setFound([]); setWhen(nowLocal()); setLocation('CLASSROOM'); setCategory(''); setSeverity('MINOR'); setDescription(''); setWitnesses(''); setChosen([]); setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function search(v: string) {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setFound([]); return; }
    timer.current = setTimeout(async () => {
      const r = await api(`/api/students/search?q=${encodeURIComponent(v.trim())}`);
      if (r.ok) setFound((r.body.data.students as PickedStudent[]).filter((s) => !students.some((x) => x.id === s.id)));
    }, 300);
  }

  async function submit() {
    const actions = chosen.map((type) => (type === 'SUSPENSION' ? { type, startDate: suspension.start, endDate: suspension.end } : { type }));
    const r = await run(() => api('/api/students/discipline', 'POST', { studentIds: students.map((s) => s.id), occurredAt: when, location, category, severity, description, witnesses: witnesses || undefined, actions }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    const waiting = (r.body.data.actions as { status: string }[]).filter((a) => a.status === 'PENDING').length;
    toast.success(waiting ? 'Incident saved. The Head will be asked to decide.' : 'Incident saved');
    onDone?.();
    onClose();
  }

  const toggle = (t: string) => setChosen((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));
  return (
    <Modal open={open} onClose={onClose} title="Record an incident" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!students.length || !category || description.trim().length < 5}>Save incident</Button></>}>
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-medium text-ink">Students <span className="text-danger" aria-hidden="true">*</span></p>
          <div className="flex flex-wrap gap-1.5">
            {students.map((s) => (
              <span key={s.id} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-tint px-3 text-sm text-primary">
                {s.fullName}
                <button type="button" aria-label={`Remove ${s.fullName}`} onClick={() => setStudents((l) => l.filter((x) => x.id !== s.id))} className="ml-1 rounded-full px-1.5 text-base leading-none hover:bg-white">×</button>
              </span>
            ))}
          </div>
          <input type="search" value={q} onChange={(e) => search(e.target.value)} placeholder="Add another student: type 2 letters of a name" aria-label="Find a student"
            className="mt-2 min-h-[44px] w-full rounded-xl border border-line px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          {found.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-line bg-white">
              {found.map((s) => (
                <li key={s.id}><button type="button" onClick={() => { setStudents((l) => [...l, s]); setFound([]); setQ(''); }} className="flex min-h-[44px] w-full items-center justify-between px-3 text-left text-sm hover:bg-tint">
                  <span>{s.fullName}</span><span className="text-xs text-muted">{s.className ?? ''} {s.admissionNumber ?? ''}</span></button></li>
              ))}
            </ul>
          )}
          {errors.studentIds && <p role="alert" className="mt-1 text-xs text-danger">{errors.studentIds}</p>}
        </div>
        <FormGrid>
          <Input id="inc-when" type="datetime-local" label="Date and time" required value={when} max={nowLocal()} onChange={(e) => setWhen(e.target.value)} error={errors.occurredAt} />
          <Select id="inc-loc" label="Where" required value={location} onChange={(e) => setLocation(e.target.value)} options={LOCATIONS.map(([value, label]) => ({ value, label }))} error={errors.location} />
          <Select id="inc-cat" label="Category" required placeholder="Choose a category" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES.map(([value, label]) => ({ value, label }))} error={errors.category} />
          <Select id="inc-sev" label="How serious" required value={severity} onChange={(e) => setSeverity(e.target.value)} options={SEVERITIES.map(([value, label]) => ({ value, label }))} error={errors.severity} hint={severity === 'SERIOUS' ? 'The Head is told about serious incidents.' : undefined} />
        </FormGrid>
        <TextArea id="inc-desc" label="What happened" required value={description} onChange={setDescription} rows={3} hint="In plain words." error={errors.description} />
        <Input id="inc-wit" label="Witnesses" hint="Staff or students, if any." value={witnesses} onChange={(e) => setWitnesses(e.target.value)} />
        <fieldset>
          <legend className="text-sm font-medium text-ink">Action taken</legend>
          {ACTIONS.map(([value, label]) => <Checkbox key={value} label={label} checked={chosen.includes(value)} onChange={() => toggle(value)} />)}
          {chosen.includes('SUSPENSION') && (
            <div className="mt-1"><FormGrid>
              <Input id="sus-start" type="date" label="Suspension starts" value={suspension.start} onChange={(e) => setSuspension((s) => ({ ...s, start: e.target.value }))} error={errors['actions.0.startDate']} />
              <Input id="sus-end" type="date" label="Last day of suspension" value={suspension.end} min={suspension.start} onChange={(e) => setSuspension((s) => ({ ...s, end: e.target.value }))} error={errors['actions.0.endDate']} />
            </FormGrid></div>
          )}
        </fieldset>
        {errors.form && !Object.keys(errors).some((k) => k !== 'form') && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
        {Object.keys(errors).length > 0 && errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

// ─── Start the leaving process ───────────────────────────────────────────────

const EXIT_REASONS = [
  ['TRANSFER', 'Transfer to another school'], ['COMPLETED_O_LEVEL', 'Completed O Level'], ['COMPLETED_A_LEVEL', 'Completed A Level'], ['WITHDRAWN_BY_GUARDIAN', 'Withdrawn by guardian'],
  ['RELOCATED_ABROAD', 'Relocated outside Zimbabwe'], ['EXPELLED', 'Expelled'], ['DECEASED', 'Deceased'], ['OTHER', 'Other'],
] as const;

export function LeavingModal({ student, open, onClose, onDone }: { student: PickedStudent; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [lastDay, setLastDay] = useState(today());
  const [school, setSchool] = useState('');
  const [district, setDistrict] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  useEffect(() => { if (open) { setReason(''); setLastDay(today()); setSchool(''); setDistrict(''); setNote(''); setErrors({}); } }, [open]);
  async function submit() {
    const r = await run(() => api('/api/students/leaving', 'POST', { studentId: student.id, reason, lastDay, reasonNote: note || undefined, destinationSchool: school || undefined, destinationDistrict: district || undefined }));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Leaving process started. The Head will be asked to approve it.');
    onDone();
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title={`Start the leaving process for ${student.fullName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!reason}>Start</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">The student stays on the class list until the Head approves and the leaving is finished. A clearance checklist (fees, library, hostel, property, sports kit) is made for you.</p>
        <FormGrid>
          <Select id="lv-reason" label="Reason" required placeholder="Choose a reason" value={reason} onChange={(e) => setReason(e.target.value)} options={EXIT_REASONS.map(([value, label]) => ({ value, label }))} error={errors.reason} />
          <Input id="lv-day" type="date" label="Last day attended" required value={lastDay} onChange={(e) => setLastDay(e.target.value)} error={errors.lastDay} />
        </FormGrid>
        {reason === 'TRANSFER' && (
          <FormGrid>
            <Input id="lv-school" label="New school" required value={school} onChange={(e) => setSchool(e.target.value)} error={errors.destinationSchool} />
            <Input id="lv-district" label="District" required value={district} onChange={(e) => setDistrict(e.target.value)} error={errors.destinationDistrict} />
          </FormGrid>
        )}
        <TextArea id="lv-note" label="Note" required={reason === 'OTHER'} rows={2} value={note} onChange={setNote} error={errors.reasonNote} />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
