'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import type { MedicalView } from '@/lib/students/medical';
import { api, Checkbox, Facts, fieldMessages, formatWhen, FormGrid, problem, Section, TextArea, useBusy } from '@/components/students/shared';

const CONDITIONS = ['Asthma', 'Epilepsy', 'Diabetes', 'Sickle cell', 'Heart condition', 'Other'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const AIDS = ['CIMAS', 'PSMAS', 'First Mutual', 'Other'];
const KEEPERS = [['STUDENT', 'Student'], ['MATRON', 'Matron'], ['OFFICE', 'Office']] as const;
const OUTCOME: Record<string, string> = { RETURNED_TO_CLASS: 'Back to class', SENT_HOME: 'Sent home', SENT_TO_CLINIC: 'Sent to clinic' };

export function MedicalTab({ studentId, m, canEdit }: { studentId: string; m: MedicalView; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [visit, setVisit] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p role="note" className="rounded-xl bg-canvas px-3 py-2 text-xs text-muted">Medical details are confidential. Every time this tab is opened it is recorded in the audit log.</p>
      <Section title="Medical details" action={canEdit && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}>
        <Facts rows={[
          ['Conditions', m.conditions.length ? m.conditions.map((c) => (c.note ? `${c.name}: ${c.note}` : c.name)).join('; ') : null],
          ['Blood group', m.bloodGroup],
          ['Medical aid', [m.medicalAid.provider, m.medicalAid.number, m.medicalAid.mainMember && `main member ${m.medicalAid.mainMember}`].filter(Boolean).join(', ') || null],
          ['Family doctor', [m.doctor.name, m.doctor.phone].filter(Boolean).join(', ') || null],
          ['Emergency contact', [m.emergency.name, m.emergency.phone, m.emergency.relationship].filter(Boolean).join(', ') ? `${[m.emergency.name, m.emergency.phone, m.emergency.relationship].filter(Boolean).join(', ')}${m.emergency.fromPrimaryGuardian ? ' (primary guardian)' : ''}` : null],
          ['Disability or special needs', m.specialNeeds.type], ['Support needed in class and exams', m.specialNeeds.supportNeeded],
          ['Consent for emergency treatment', m.consent.emergencyTreatment === null ? null : m.consent.emergencyTreatment ? `Yes${m.consent.date ? `, ${m.consent.date}` : ''}${m.consent.hasForm ? ' (form on file)' : ''}` : 'No'],
          ['Notes', m.notes],
        ]} />
      </Section>
      <Section title="Allergies">
        {m.allergies.length === 0 ? <p className="text-sm text-muted">None recorded.</p> : (
          <ul className="flex flex-wrap gap-2">{m.allergies.map((a, i) => <li key={i}><Badge variant={a.severity === 'SEVERE' ? 'danger' : 'warning'} label={`${a.name} (${a.severity === 'SEVERE' ? 'severe' : 'mild'})`} /></li>)}</ul>
        )}
      </Section>
      <Section title="Regular medication">
        {m.medications.length === 0 ? <p className="text-sm text-muted">None recorded.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {m.medications.map((x) => <li key={x.id} className="py-2 text-sm"><span className="font-medium">{x.name}</span> {x.dose && `· ${x.dose}`} {x.whenGiven && `· ${x.whenGiven}`} <span className="text-muted">· kept by {x.keptBy.toLowerCase()}</span></li>)}
          </ul>
        )}
      </Section>
      {m.sickBay.enabled && (
        <Section title="Sick bay visits" action={canEdit && <Button size="sm" variant="secondary" onClick={() => setVisit(true)}>Record a visit</Button>}>
          {m.sickBay.visits.length === 0 ? <p className="text-sm text-muted">No visits.</p> : (
            <ul className="flex flex-col divide-y divide-line">
              {m.sickBay.visits.map((v) => (
                <li key={v.id} className="py-2 text-sm"><p className="font-medium">{v.complaint}</p><p className="text-xs text-muted">{formatWhen(v.visitedAt)} · {v.treatment ?? 'no treatment noted'} · {OUTCOME[v.outcome]} · guardian {v.guardianInformed ? 'informed' : 'not yet informed'}</p></li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {editing && <EditModal studentId={studentId} m={m} onClose={() => setEditing(false)} onDone={() => { setEditing(false); router.refresh(); }} />}
      {visit && <VisitModal studentId={studentId} onClose={() => setVisit(false)} onDone={() => { setVisit(false); router.refresh(); }} />}
    </div>
  );
}

function EditModal({ studentId, m, onClose, onDone }: { studentId: string; m: MedicalView; onClose: () => void; onDone: () => void }) {
  const [conditions, setConditions] = useState(m.conditions);
  const [allergies, setAllergies] = useState(m.allergies);
  const [meds, setMeds] = useState(m.medications.map((x) => ({ name: x.name, dose: x.dose ?? '', whenGiven: x.whenGiven ?? '', keptBy: x.keptBy })));
  const [f, setF] = useState({
    bloodGroup: m.bloodGroup ?? '', provider: m.medicalAid.provider ?? '', aidNumber: m.medicalAid.number ?? '', mainMember: m.medicalAid.mainMember ?? '', doctorName: m.doctor.name ?? '', doctorPhone: m.doctor.phone ?? '',
    emName: m.emergency.fromPrimaryGuardian ? '' : m.emergency.name ?? '', emPhone: m.emergency.fromPrimaryGuardian ? '' : m.emergency.phone ?? '', emRel: m.emergency.fromPrimaryGuardian ? '' : m.emergency.relationship ?? '',
    snType: m.specialNeeds.type ?? '', snSupport: m.specialNeeds.supportNeeded ?? '', consent: m.consent.emergencyTreatment === null ? '' : m.consent.emergencyTreatment ? 'yes' : 'no', consentDate: m.consent.date ?? '', notes: m.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    const body = {
      conditions, allergies, medications: meds.filter((x) => x.name.trim()).map((x) => ({ name: x.name, dose: x.dose || undefined, whenGiven: x.whenGiven || undefined, keptBy: x.keptBy })),
      bloodGroup: f.bloodGroup || null, medicalAid: { provider: f.provider || undefined, number: f.aidNumber || undefined, mainMember: f.mainMember || undefined },
      doctor: { name: f.doctorName || undefined, phone: f.doctorPhone || undefined }, emergency: { name: f.emName || undefined, phone: f.emPhone || undefined, relationship: f.emRel || undefined },
      specialNeeds: { type: f.snType || undefined, supportNeeded: f.snSupport || undefined },
      consent: { emergencyTreatment: f.consent === '' ? null : f.consent === 'yes', date: f.consentDate || undefined }, notes: f.notes || undefined,
    };
    const r = await run(() => api(`/api/students/${studentId}/medical`, 'PUT', body));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success('Medical details saved');
    onDone();
  }

  return (
    <Modal open onClose={onClose} title="Edit medical details" size="xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <fieldset><legend className="text-sm font-medium text-ink">Conditions</legend>
          {CONDITIONS.map((c) => {
            const on = conditions.find((x) => x.name === c);
            return (
              <div key={c}>
                <Checkbox label={c} checked={!!on} onChange={(v) => setConditions((l) => (v ? [...l, { name: c }] : l.filter((x) => x.name !== c)))} />
                {on && c === 'Other' && <div className="ml-7"><Input id="c-other" label="Say what it is" value={on.note ?? ''} onChange={(e) => setConditions((l) => l.map((x) => (x.name === c ? { ...x, note: e.target.value } : x)))} error={errors['conditions.0.note']} /></div>}
              </div>
            );
          })}
        </fieldset>
        <fieldset><legend className="text-sm font-medium text-ink">Allergies</legend>
          {allergies.map((a, i) => (
            <div key={i} className="mt-1.5 grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Input id={`al-${i}`} label={i === 0 ? 'Allergy' : undefined} aria-label="Allergy" value={a.name} onChange={(e) => setAllergies((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select id={`as-${i}`} aria-label="Severity" value={a.severity} onChange={(e) => setAllergies((l) => l.map((x, j) => (j === i ? { ...x, severity: e.target.value as 'MILD' | 'SEVERE' } : x)))} options={[{ value: 'MILD', label: 'Mild' }, { value: 'SEVERE', label: 'Severe' }]} />
              <Button variant="ghost" size="sm" aria-label="Remove allergy" onClick={() => setAllergies((l) => l.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAllergies((l) => [...l, { name: '', severity: 'MILD' }])}>Add an allergy</Button>
          <p className="mt-1 text-xs text-muted">Severe allergies show in the alert line at the top of the profile.</p>
        </fieldset>
        <fieldset><legend className="text-sm font-medium text-ink">Regular medication</legend>
          {meds.map((x, i) => (
            <div key={i} className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
              <Input id={`md-n-${i}`} aria-label="Medicine" placeholder="Medicine" value={x.name} onChange={(e) => setMeds((l) => l.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <Input id={`md-d-${i}`} aria-label="Dose" placeholder="Dose" value={x.dose} onChange={(e) => setMeds((l) => l.map((y, j) => (j === i ? { ...y, dose: e.target.value } : y)))} />
              <Input id={`md-w-${i}`} aria-label="When" placeholder="When" value={x.whenGiven} onChange={(e) => setMeds((l) => l.map((y, j) => (j === i ? { ...y, whenGiven: e.target.value } : y)))} />
              <Select id={`md-k-${i}`} aria-label="Kept by" value={x.keptBy} onChange={(e) => setMeds((l) => l.map((y, j) => (j === i ? { ...y, keptBy: e.target.value as typeof x.keptBy } : y)))} options={KEEPERS.map(([value, label]) => ({ value, label: `Kept by ${label.toLowerCase()}` }))} />
              <Button variant="ghost" size="sm" aria-label="Remove medicine" onClick={() => setMeds((l) => l.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setMeds((l) => [...l, { name: '', dose: '', whenGiven: '', keptBy: 'STUDENT' }])}>Add medicine</Button>
        </fieldset>
        <FormGrid>
          <Select id="bg" label="Blood group" placeholder="Not recorded" value={f.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)} options={BLOOD.map((b) => ({ value: b, label: b }))} />
          <Select id="ma" label="Medical aid" placeholder="None" value={f.provider} onChange={(e) => set('provider', e.target.value)} options={AIDS.map((b) => ({ value: b, label: b }))} />
          <Input id="man" label="Member number" value={f.aidNumber} onChange={(e) => set('aidNumber', e.target.value)} />
          <Input id="mam" label="Main member" value={f.mainMember} onChange={(e) => set('mainMember', e.target.value)} />
          <Input id="dn" label="Family doctor" value={f.doctorName} onChange={(e) => set('doctorName', e.target.value)} />
          <Input id="dp" type="tel" label="Doctor phone" value={f.doctorPhone} onChange={(e) => set('doctorPhone', e.target.value)} error={errors['doctor.phone']} />
          <Input id="en" label="Emergency contact (leave empty for the primary guardian)" value={f.emName} onChange={(e) => set('emName', e.target.value)} />
          <Input id="ep" type="tel" label="Emergency phone" value={f.emPhone} onChange={(e) => set('emPhone', e.target.value)} />
          <Input id="er" label="Emergency contact relationship" value={f.emRel} onChange={(e) => set('emRel', e.target.value)} />
          <Input id="sn" label="Disability or special needs" value={f.snType} onChange={(e) => set('snType', e.target.value)} />
        </FormGrid>
        <TextArea id="sns" label="Support needed in class and exams" rows={2} value={f.snSupport} onChange={(v) => set('snSupport', v)} />
        <FormGrid>
          <Select id="cs" label="Consent for emergency treatment" placeholder="Not recorded" value={f.consent} onChange={(e) => set('consent', e.target.value)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          <Input id="csd" type="date" label="Consent date" value={f.consentDate} onChange={(e) => set('consentDate', e.target.value)} />
        </FormGrid>
        <TextArea id="mn" label="Notes" rows={3} value={f.notes} onChange={(v) => set('notes', v)} />
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}

function VisitModal({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Harare' }));
  const p = (n: number) => String(n).padStart(2, '0');
  const [f, setF] = useState({ visitedAt: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`, complaint: '', treatment: '', outcome: 'RETURNED_TO_CLASS', guardianInformed: false });
  const [error, setError] = useState('');
  const { busy, run } = useBusy();
  async function submit() {
    const r = await run(() => api(`/api/students/${studentId}/medical/sick-bay`, 'POST', { ...f, treatment: f.treatment || undefined }));
    if (!r) return;
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Visit recorded');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Sick bay visit" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!f.complaint}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Input id="v-when" type="datetime-local" label="Date and time" required value={f.visitedAt} onChange={(e) => setF({ ...f, visitedAt: e.target.value })} />
        <Input id="v-comp" label="Complaint" required value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} />
        <Input id="v-treat" label="Treatment" value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })} />
        <Select id="v-out" label="Afterwards" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} options={Object.entries(OUTCOME).map(([value, label]) => ({ value, label }))} />
        <Checkbox label="Guardian informed" checked={f.guardianInformed} onChange={(v) => setF({ ...f, guardianInformed: v })} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
