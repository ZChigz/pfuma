'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { LEVEL_AGE_RANGES } from '@/lib/students/registration';
import { api, Checkbox, fieldMessages, FormGrid, problem, Section, TextArea, useBusy, WarningList } from '@/components/students/shared';
import { LANGUAGES as HOME_LANGUAGES, NATIONALITIES, RELIGIONS, opts } from '@/components/students/EditStudentForm';
import { PhotoPicker } from '@/components/students/PhotoPicker';
import { RELATIONSHIP_OPTIONS } from '@/components/students/profile/GuardiansTab';

export interface ClassInfo { id: string; name: string; levelOrder: number; levelName: string; size: number; capacity: number }

interface GuardianDraft {
  existingGuardianId?: string; foundLabel?: string; fullName: string; phone: string; phone2: string; email: string; nationalId: string; occupation: string; address: string;
  relationship: string; relationshipNote: string; isPrimary: boolean; isFeePayer: boolean; receivesSms: boolean; canCollect: boolean; custodyNote: string;
}

const blankGuardian = (primary = false): GuardianDraft => ({ fullName: '', phone: '', phone2: '', email: '', nationalId: '', occupation: '', address: '', relationship: 'MOTHER', relationshipNote: '', isPrimary: primary, isFeePayer: primary, receivesSms: true, canCollect: true, custodyNote: '' });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());
const STEPS = ['Personal details', 'Enrolment', 'Guardians', 'Review and save'];
const ENTRY = [['NEW_FORM_1', 'New Form 1'], ['NEW_LOWER_6', 'New Lower 6'], ['TRANSFER_IN', 'Transfer in'], ['RETURNING', 'Returning']];

interface Check {
  className: string; classCount: number; capacity: number; admissionNumberPreview: string; needsApproval: boolean;
  warnings: { code: string; message: string }[];
  possibleDuplicates: { id: string; fullName: string; admissionNumber: string; className: string | null }[];
  certificateMatch: { id: string; fullName: string; admissionNumber: string } | null;
  guardianMatches: { phone: string; guardianId: string; fullName: string; children: { fullName: string; className: string | null }[] }[];
}

export function AddStudentWizard({ classes, houses, canApproveTransfers }: { classes: ClassInfo[]; houses: { id: string; name: string }[]; canApproveTransfers: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState({
    firstName: '', surname: '', preferredName: '', gender: '', dateOfBirth: '', birthCertificateNumber: '', nationality: 'Zimbabwean', homeLanguage: '', religion: '', photoUrl: '',
    admissionDate: today(), classId: '', boarding: 'DAY', houseId: '', entryType: 'NEW_FORM_1', previousSchool: '', grade7Units: '', oLevelPasses: '', oLevelPoints: '',
    isBeam: false, sponsorName: '', orphanStatus: 'NONE', specialNeeds: false, specialNeedsNote: '', address: '',
  });
  const [guardians, setGuardians] = useState<GuardianDraft[]>([blankGuardian(true)]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Check | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const { busy, run } = useBusy();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const cls = classes.find((c) => c.id === s.classId);

  const body = () => ({
    firstName: s.firstName, surname: s.surname, preferredName: s.preferredName || undefined, gender: s.gender, dateOfBirth: s.dateOfBirth, birthCertificateNumber: s.birthCertificateNumber || undefined,
    nationality: s.nationality || undefined, homeLanguage: s.homeLanguage || undefined, religion: s.religion || undefined, photoUrl: s.photoUrl || undefined, admissionDate: s.admissionDate,
    classId: s.classId, boarding: s.boarding, houseId: s.houseId || undefined, entryType: s.entryType, previousSchool: s.previousSchool || undefined,
    entryResults: s.entryType === 'NEW_FORM_1' ? (s.grade7Units ? { grade7Units: Number(s.grade7Units) } : undefined) : s.entryType === 'NEW_LOWER_6' ? { ...(s.oLevelPasses ? { oLevelPasses: Number(s.oLevelPasses) } : {}), ...(s.oLevelPoints ? { oLevelPoints: Number(s.oLevelPoints) } : {}) } : undefined,
    isBeam: s.isBeam, sponsorName: s.sponsorName || undefined, orphanStatus: s.orphanStatus, specialNeeds: s.specialNeeds, specialNeedsNote: s.specialNeeds ? s.specialNeedsNote || undefined : undefined, address: s.address || undefined,
    guardians: guardians.map((g) => (g.existingGuardianId
      ? { existingGuardianId: g.existingGuardianId, relationship: g.relationship, relationshipNote: g.relationshipNote || undefined, isPrimary: g.isPrimary, isFeePayer: g.isFeePayer, receivesSms: g.receivesSms, canCollect: g.canCollect, custodyNote: g.custodyNote || undefined }
      : { fullName: g.fullName, phone: g.phone, phone2: g.phone2 || undefined, email: g.email || undefined, nationalId: g.nationalId || undefined, occupation: g.occupation || undefined, address: g.address || undefined, relationship: g.relationship, relationshipNote: g.relationshipNote || undefined, isPrimary: g.isPrimary, isFeePayer: g.isFeePayer, receivesSms: g.receivesSms, canCollect: g.canCollect, custodyNote: g.custodyNote || undefined })),
  });

  // Light checks on the way: the server still checks everything again at the review step and at saving.
  function validate(at: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (at === 0) {
      if (s.firstName.trim().length < 2) e.firstName = 'Enter the first name(s)';
      if (s.surname.trim().length < 2) e.surname = 'Enter the surname';
      if (!s.gender) e.gender = 'Choose Male or Female';
      if (!s.dateOfBirth) e.dateOfBirth = 'Enter the date of birth'; else if (s.dateOfBirth > today()) e.dateOfBirth = 'The date of birth cannot be in the future';
    }
    if (at === 1) {
      if (!s.classId) e.classId = 'Choose the class';
      if ((s.entryType === 'TRANSFER_IN' || s.entryType === 'NEW_LOWER_6') && !s.previousSchool.trim()) e.previousSchool = 'Name the previous school';
      if (s.specialNeeds && !s.specialNeedsNote.trim()) e.specialNeedsNote = 'Add a note about the support needed';
    }
    if (at === 2) {
      guardians.forEach((g, i) => {
        if (!g.existingGuardianId) {
          if (!g.fullName.trim().includes(' ')) e[`guardians.${i}.fullName`] = "Enter the guardian's first name and surname";
          if (!g.phone.trim()) e[`guardians.${i}.phone`] = 'Enter a phone number';
        }
      });
      if (guardians.filter((g) => g.isPrimary).length !== 1) e.guardians = 'Choose exactly one primary contact';
    }
    return e;
  }

  function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (step === 2) { void review(); return; }
    setStep(step + 1);
  }

  async function review() {
    const r = await run(() => api('/api/students/check', 'POST', body()));
    if (!r) return;
    if (!r.ok) { setErrors(fieldMessages(r)); setStep(stepOf(Object.keys(fieldMessages(r))[0] ?? '')); toast.error(problem(r)); return; }
    setCheck(r.body.data); setAccepted([]); setErrors({}); setStep(3);
  }
  const stepOf = (field: string) => (field.startsWith('guardians') ? 2 : ['classId', 'admissionDate', 'boarding', 'houseId', 'entryType', 'previousSchool', 'entryResults', 'specialNeedsNote', 'sponsorName'].includes(field.split('.')[0]!) ? 1 : 0);

  async function save() {
    const r = await run(() => api('/api/students', 'POST', { student: body(), acknowledgedWarnings: accepted }));
    if (!r) return;
    if (!r.ok) { toast.error(problem(r)); setErrors(fieldMessages(r)); return; }
    toast.success(`Saved as ${r.body.data.student.admissionNumber}`);
    router.push(`/students/${r.body.data.student.id}`);
  }

  const range = cls && cls.levelName in LEVEL_AGE_RANGES ? LEVEL_AGE_RANGES[cls.levelName as keyof typeof LEVEL_AGE_RANGES] : null;
  const age = s.dateOfBirth ? Math.floor((Date.now() - new Date(s.dateOfBirth).getTime()) / (365.25 * 864e5)) : null;
  const ageHint = range && age !== null && (age < range[0] || age > range[1]) ? `${age} years old. ${cls!.levelName} students are usually ${range[0]}–${range[1]}. You can still save.` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-1 overflow-x-auto" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button type="button" disabled={i > step} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
              className={cn('flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold sm:text-sm', i === step ? 'bg-primary text-white' : i < step ? 'bg-tint text-primary' : 'bg-white text-muted')}>
              <span aria-hidden="true">{i + 1}</span><span className="hidden sm:inline">{label}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-sm font-semibold text-ink sm:hidden">{STEPS[step]}</p>

      {step === 0 && (
        <Section title="Personal details">
          <div className="flex flex-col gap-3">
            <PhotoPicker value={s.photoUrl} onChange={(u) => set('photoUrl', u)} />
            <FormGrid>
              <Input id="fn" label="First name(s)" required autoComplete="off" value={s.firstName} onChange={(e) => set('firstName', e.target.value)} error={errors.firstName} hint="Capital letters are added for you." />
              <Input id="sn" label="Surname" required autoComplete="off" value={s.surname} onChange={(e) => set('surname', e.target.value)} error={errors.surname} />
              <Input id="pn" label="Preferred name" value={s.preferredName} onChange={(e) => set('preferredName', e.target.value)} />
              <Select id="g" label="Gender" required placeholder="Choose" value={s.gender} onChange={(e) => set('gender', e.target.value)} options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]} error={errors.gender} />
              <Input id="dob" type="date" label="Date of birth" required max={today()} value={s.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth} />
              <Input id="bc" label="Birth certificate number" placeholder="63-123456 A 42" value={s.birthCertificateNumber} onChange={(e) => set('birthCertificateNumber', e.target.value)} error={errors.birthCertificateNumber} hint="Recommended. Spaces and dashes are fine." />
              <Select id="nat" label="Nationality" placeholder="Not recorded" value={s.nationality} onChange={(e) => set('nationality', e.target.value)} options={opts(NATIONALITIES)} />
              <Select id="lang" label="Home language" placeholder="Not recorded" value={s.homeLanguage} onChange={(e) => set('homeLanguage', e.target.value)} options={opts(HOME_LANGUAGES)} />
              <Select id="rel" label="Religion or denomination" placeholder="Not recorded" value={s.religion} onChange={(e) => set('religion', e.target.value)} options={opts(RELIGIONS)} />
            </FormGrid>
          </div>
        </Section>
      )}

      {step === 1 && (
        <Section title="Enrolment">
          <div className="flex flex-col gap-3">
            <FormGrid>
              <Input id="adm" label="Admission number" value={check?.admissionNumberPreview ?? 'Made when you save'} readOnly disabled hint="Made from the school's numbering format." />
              <Input id="ad" type="date" label="Admission date" required max={today()} value={s.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} error={errors.admissionDate} />
              <Select id="entry" label="Entry type" required value={s.entryType} onChange={(e) => set('entryType', e.target.value)} options={ENTRY.map(([value, label]) => ({ value: value!, label: label! }))} />
              <Select id="class" label="Form and class" required placeholder="Choose a class" value={s.classId} onChange={(e) => set('classId', e.target.value)}
                options={classes.map((c) => ({ value: c.id, label: `${c.name} — ${c.size}/${c.capacity}${c.size >= c.capacity ? ' (full)' : ''}` }))} error={errors.classId} hint={cls && cls.size >= cls.capacity ? `${cls.name} is full: ${cls.size} of ${cls.capacity}. You can still add the student.` : ageHint} />
              <Select id="bd" label="Boarding" value={s.boarding} onChange={(e) => set('boarding', e.target.value)} options={[{ value: 'DAY', label: 'Day scholar' }, { value: 'BOARDER', label: 'Boarder' }]} />
              <Select id="hs" label="House" placeholder="No house" value={s.houseId} onChange={(e) => set('houseId', e.target.value)} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
            </FormGrid>
            {(s.entryType === 'TRANSFER_IN' || s.entryType === 'NEW_LOWER_6') && <Input id="prev" label="Previous school" required value={s.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} error={errors.previousSchool} />}
            {s.entryType === 'TRANSFER_IN' && !canApproveTransfers && <p role="note" className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">A transfer in is approved by the Head. You can fill this in, but only someone who may approve admissions can save it.</p>}
            {s.entryType === 'NEW_FORM_1' && <Input id="g7" type="number" min={4} max={36} label="Grade 7 units" hint="Lower is better (4 to 36)." value={s.grade7Units} onChange={(e) => set('grade7Units', e.target.value)} error={errors['entryResults.grade7Units']} />}
            {s.entryType === 'NEW_LOWER_6' && <FormGrid><Input id="olp" type="number" min={0} max={14} label="O Level passes" value={s.oLevelPasses} onChange={(e) => set('oLevelPasses', e.target.value)} /><Input id="olpt" type="number" min={0} max={60} label="O Level points" value={s.oLevelPoints} onChange={(e) => set('oLevelPoints', e.target.value)} /></FormGrid>}
            <fieldset className="rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">Support</legend>
              <Checkbox label="BEAM beneficiary" checked={s.isBeam} onChange={(v) => set('isBeam', v)} />
              <FormGrid>
                <Input id="spon" label="Sponsor name" value={s.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} />
                <Select id="orp" label="Orphan status" value={s.orphanStatus} onChange={(e) => set('orphanStatus', e.target.value)} options={[{ value: 'NONE', label: 'Not an orphan' }, { value: 'SINGLE', label: 'Single orphan' }, { value: 'DOUBLE', label: 'Double orphan' }]} />
              </FormGrid>
              <Checkbox label="Has special educational needs" checked={s.specialNeeds} onChange={(v) => set('specialNeeds', v)} />
              {s.specialNeeds && <TextArea id="snn" label="Note on the support needed" required rows={2} value={s.specialNeedsNote} onChange={(v) => set('specialNeedsNote', v)} error={errors.specialNeedsNote} />}
            </fieldset>
            <Input id="addr" label="Home address" value={s.address} onChange={(e) => set('address', e.target.value)} />
          </div>
        </Section>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          {errors.guardians && <p role="alert" className="text-sm text-danger">{errors.guardians}</p>}
          {guardians.map((g, i) => (
            <GuardianCard key={i} index={i} g={g} errors={errors} removable={guardians.length > 1}
              onChange={(next) => setGuardians((l) => l.map((x, j) => (j === i ? next : next.isPrimary && x.isPrimary ? { ...x, isPrimary: false } : x)))}
              onRemove={() => setGuardians((l) => l.filter((_, j) => j !== i))} />
          ))}
          {guardians.length < 6 && <div><Button type="button" variant="secondary" onClick={() => setGuardians((l) => [...l, blankGuardian(false)])}>Add another guardian</Button></div>}
        </div>
      )}

      {step === 3 && check && (
        <div className="flex flex-col gap-4">
          <Section title="Check and save">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {[
                ['Student', `${s.firstName} ${s.surname}${s.preferredName ? ` (${s.preferredName})` : ''}`, 0], ['Gender and age', `${s.gender === 'M' ? 'Male' : 'Female'}${age !== null ? `, ${age} years` : ''}`, 0],
                ['Birth certificate', s.birthCertificateNumber || 'not given', 0], ['Admission number', check.admissionNumberPreview, 1], ['Class', `${check.className} (${check.classCount} of ${check.capacity} places taken)`, 1],
                ['Entry', ENTRY.find(([v]) => v === s.entryType)![1]!, 1], ['Boarding', `${s.boarding === 'DAY' ? 'Day scholar' : 'Boarder'}${houses.find((h) => h.id === s.houseId) ? `, ${houses.find((h) => h.id === s.houseId)!.name} house` : ''}`, 1],
                ['Guardians', guardians.map((g) => `${g.existingGuardianId ? g.foundLabel : g.fullName}${g.isPrimary ? ' (primary)' : ''}`).join(', '), 2],
              ].map(([k, v, at]) => (
                <div key={k as string} className="flex items-start justify-between gap-2 rounded-xl bg-canvas px-3 py-2"><div><dt className="text-xs text-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></div><button type="button" onClick={() => setStep(at as number)} className="min-h-[44px] px-2 text-xs font-semibold text-primary underline">Edit</button></div>
              ))}
            </dl>
          </Section>
          {check.certificateMatch && (
            <div role="alert" className="rounded-xl border border-danger/40 bg-danger-bg p-3 text-sm text-danger">
              This birth certificate number already belongs to <strong>{check.certificateMatch.fullName}</strong> ({check.certificateMatch.admissionNumber}); the same certificate cannot be saved twice.{' '}
              <Link href={`/students/${check.certificateMatch.id}`} className="font-semibold underline">Open existing</Link>
            </div>
          )}
          {check.possibleDuplicates.map((d) => (
            <div key={d.id} role="note" className="rounded-xl border border-warn/40 bg-warn-bg p-3 text-sm text-ink">
              A student with the same name and date of birth is already registered: <strong>{d.fullName}</strong> ({d.admissionNumber}){d.className ? `, ${d.className}` : ''}.{' '}
              <Link href={`/students/${d.id}`} className="font-semibold text-primary underline">Open existing</Link>
            </div>
          ))}
          {check.guardianMatches.map((m) => (
            <div key={m.guardianId} role="note" className="rounded-xl bg-tint p-3 text-sm text-ink">{m.fullName} ({m.phone}) is already in the school{m.children.length ? ` with ${m.children.length} child${m.children.length === 1 ? '' : 'ren'}: ${m.children.map((c) => `${c.fullName}${c.className ? ` (${c.className})` : ''}`).join(', ')}` : ''}. The same guardian record is used, so siblings share it.</div>
          ))}
          {check.needsApproval && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">A transfer in is approved by the Head. Ask someone who may approve admissions to save this student.</p>}
          <WarningList warnings={check.warnings} accepted={accepted} onToggle={(c) => setAccepted((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]))} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3 && <Button type="button" onClick={next} loading={busy}>{step === 2 ? 'Review' : 'Next'}</Button>}
        {step === 3 && check && <Button type="button" onClick={save} loading={busy} disabled={!!check.certificateMatch || check.needsApproval || check.warnings.some((w) => !accepted.includes(w.code))}>{check.possibleDuplicates.length ? 'Save anyway' : 'Save student'}</Button>}
        <Link href="/students" className="ml-auto min-h-[44px] px-3 py-3 text-sm text-muted underline">Cancel</Link>
      </div>
    </div>
  );
}

function GuardianCard({ index, g, errors, removable, onChange, onRemove }: { index: number; g: GuardianDraft; errors: Record<string, string>; removable: boolean; onChange: (g: GuardianDraft) => void; onRemove: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [found, setFound] = useState<{ guardianId: string; fullName: string; phone: string; children: { fullName: string; className: string | null }[] } | null>(null);
  const e = (k: string) => errors[`guardians.${index}.${k}`];
  const set = (k: keyof GuardianDraft, v: string | boolean) => onChange({ ...g, [k]: v });

  // Search by phone first, so siblings share one guardian record.
  useEffect(() => {
    clearTimeout(timer.current);
    if (g.existingGuardianId || g.phone.replace(/\D/g, '').length < 9) { setFound(null); return; }
    timer.current = setTimeout(async () => {
      const r = await api(`/api/students/guardians/lookup?phone=${encodeURIComponent(g.phone)}`);
      setFound(r.ok ? r.body.data.guardian : null);
    }, 400);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.phone, g.existingGuardianId]);

  return (
    <Section title={`Guardian ${index + 1}`} action={removable && <Button type="button" size="sm" variant="ghost" className="text-danger" onClick={onRemove}>Remove</Button>}>
      <div className="flex flex-col gap-3">
        {g.existingGuardianId ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-tint p-3 text-sm"><span>Linked to <strong>{g.foundLabel}</strong> (already in the school)</span><Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...g, existingGuardianId: undefined, foundLabel: undefined })}>Use a different person</Button></div>
        ) : (
          <>
            <Input id={`g${index}-phone`} type="tel" label="Phone (+263)" required placeholder="0771234567" value={g.phone} onChange={(ev) => set('phone', ev.target.value)} error={e('phone')} hint="Type the phone first: if the guardian is already here, you can link them." />
            {found && (
              <div role="status" className="rounded-xl bg-tint p-3 text-sm text-ink">
                <p>This guardian already has {found.children.length} {found.children.length === 1 ? 'child' : 'children'} here: {found.children.map((c) => `${c.fullName}${c.className ? ` (${c.className})` : ''}`).join(', ')}. Link?</p>
                <Button type="button" size="sm" className="mt-2" onClick={() => onChange({ ...g, existingGuardianId: found.guardianId, foundLabel: `${found.fullName}, ${found.phone}` })}>Link {found.fullName}</Button>
              </div>
            )}
            <FormGrid>
              <Input id={`g${index}-name`} label="Full name" required value={g.fullName} onChange={(ev) => set('fullName', ev.target.value)} error={e('fullName')} />
              <Input id={`g${index}-p2`} type="tel" label="Second phone" value={g.phone2} onChange={(ev) => set('phone2', ev.target.value)} error={e('phone2')} />
              <Input id={`g${index}-email`} type="email" label="Email" value={g.email} onChange={(ev) => set('email', ev.target.value)} error={e('email')} />
              <Input id={`g${index}-nid`} label="National ID" value={g.nationalId} onChange={(ev) => set('nationalId', ev.target.value)} error={e('nationalId')} />
              <Input id={`g${index}-occ`} label="Occupation" value={g.occupation} onChange={(ev) => set('occupation', ev.target.value)} />
              <Input id={`g${index}-addr`} label="Address" value={g.address} onChange={(ev) => set('address', ev.target.value)} />
            </FormGrid>
          </>
        )}
        <FormGrid>
          <Select id={`g${index}-rel`} label="Relationship" required value={g.relationship} onChange={(ev) => set('relationship', ev.target.value)} options={RELATIONSHIP_OPTIONS} error={e('relationship')} />
          {g.relationship === 'OTHER' && <Input id={`g${index}-reln`} label="Say how they are related" value={g.relationshipNote} onChange={(ev) => set('relationshipNote', ev.target.value)} error={e('relationshipNote')} />}
        </FormGrid>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <Checkbox label="Primary contact" checked={g.isPrimary} onChange={(v) => set('isPrimary', v)} hint="Exactly one guardian is the primary contact." />
          <Checkbox label="Fee payer" checked={g.isFeePayer} onChange={(v) => set('isFeePayer', v)} />
          <Checkbox label="Receives SMS" checked={g.receivesSms} onChange={(v) => set('receivesSms', v)} />
          <Checkbox label="Can collect the student" checked={g.canCollect} onChange={(v) => set('canCollect', v)} />
        </div>
        <Input id={`g${index}-cust`} label="Custody note" placeholder="e.g. Only collect with mother" value={g.custodyNote} onChange={(ev) => set('custodyNote', ev.target.value)} />
      </div>
    </Section>
  );
}
