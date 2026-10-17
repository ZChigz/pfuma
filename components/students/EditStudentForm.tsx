'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, Checkbox, fieldMessages, FormGrid, problem, Section, TextArea, useBusy } from '@/components/students/shared';
import { PhotoPicker } from '@/components/students/PhotoPicker';

export interface EditableStudent {
  id: string; firstName: string; surname: string; preferredName: string; gender: 'M' | 'F'; dateOfBirth: string; birthCertificateNumber: string; canSeeCert: boolean;
  nationality: string; homeLanguage: string; religion: string; photoUrl: string; previousSchool: string; address: string; boarding: 'DAY' | 'BOARDER'; houseId: string;
  isBeam: boolean; sponsorName: string; orphanStatus: 'NONE' | 'SINGLE' | 'DOUBLE'; specialNeeds: boolean; specialNeedsNote: string; canSeeNote: boolean;
}

export const NATIONALITIES = ['Zimbabwean', 'South African', 'Zambian', 'Mozambican', 'Malawian', 'Botswana', 'Other'];
export const LANGUAGES = ['Shona', 'Ndebele', 'English', 'Kalanga', 'Tonga', 'Venda', 'Nambya', 'Shangani', 'Sotho', 'Other'];
export const RELIGIONS = ['Christian (Anglican)', 'Christian (Catholic)', 'Christian (Methodist)', 'Christian (Apostolic)', 'Christian (Pentecostal)', 'Christian (SDA)', 'Christian (Other)', 'Muslim', 'Traditional', 'None', 'Other'];
export const opts = (l: string[]) => l.map((v) => ({ value: v, label: v }));

export function EditStudentForm({ s, houses }: { s: EditableStudent; houses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState(s);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = <K extends keyof EditableStudent>(k: K, v: EditableStudent[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    // Only what the person is allowed to see can be sent back: a hidden field is left alone, never blanked.
    const body: Record<string, unknown> = {
      firstName: f.firstName, surname: f.surname, preferredName: f.preferredName || undefined, gender: f.gender, dateOfBirth: f.dateOfBirth, nationality: f.nationality || null, homeLanguage: f.homeLanguage || null,
      religion: f.religion || null, photoUrl: f.photoUrl || null, previousSchool: f.previousSchool || undefined, address: f.address || undefined, boarding: f.boarding, houseId: f.houseId || null,
      isBeam: f.isBeam, sponsorName: f.sponsorName || undefined, orphanStatus: f.orphanStatus, specialNeeds: f.specialNeeds,
    };
    if (s.canSeeCert) body.birthCertificateNumber = f.birthCertificateNumber || null;
    if (s.canSeeNote) body.specialNeedsNote = f.specialNeeds ? f.specialNeedsNote || undefined : undefined;
    const r = await run(() => api(`/api/students/${s.id}`, 'PATCH', body));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success(r.body.data.changed.length ? 'Saved' : 'Nothing was changed');
    router.push(`/students/${s.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4">
      <Section title="Personal details">
        <div className="flex flex-col gap-3">
          <PhotoPicker value={f.photoUrl} onChange={(u) => set('photoUrl', u)} />
          <FormGrid>
            <Input id="fn" label="First name(s)" required value={f.firstName} onChange={(e) => set('firstName', e.target.value)} error={errors.firstName} />
            <Input id="sn" label="Surname" required value={f.surname} onChange={(e) => set('surname', e.target.value)} error={errors.surname} />
            <Input id="pn" label="Preferred name" value={f.preferredName} onChange={(e) => set('preferredName', e.target.value)} error={errors.preferredName} />
            <Select id="g" label="Gender" required value={f.gender} onChange={(e) => set('gender', e.target.value as 'M' | 'F')} options={[{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]} />
            <Input id="dob" type="date" label="Date of birth" required value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth} />
            {s.canSeeCert && <Input id="bc" label="Birth certificate number" placeholder="63-123456 A 42" value={f.birthCertificateNumber} onChange={(e) => set('birthCertificateNumber', e.target.value)} error={errors.birthCertificateNumber} />}
            <Select id="nat" label="Nationality" placeholder="Not recorded" value={f.nationality} onChange={(e) => set('nationality', e.target.value)} options={opts(NATIONALITIES)} />
            <Select id="lang" label="Home language" placeholder="Not recorded" value={f.homeLanguage} onChange={(e) => set('homeLanguage', e.target.value)} options={opts(LANGUAGES)} />
            <Select id="rel" label="Religion or denomination" placeholder="Not recorded" value={f.religion} onChange={(e) => set('religion', e.target.value)} options={opts(RELIGIONS)} />
          </FormGrid>
          <Input id="addr" label="Address" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </div>
      </Section>
      <Section title="School">
        <FormGrid>
          <Select id="bd" label="Boarding" value={f.boarding} onChange={(e) => set('boarding', e.target.value as 'DAY' | 'BOARDER')} options={[{ value: 'DAY', label: 'Day scholar' }, { value: 'BOARDER', label: 'Boarder' }]} />
          <Select id="hs" label="House" placeholder="No house" value={f.houseId} onChange={(e) => set('houseId', e.target.value)} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
          <Input id="ps" label="Previous school" value={f.previousSchool} onChange={(e) => set('previousSchool', e.target.value)} />
        </FormGrid>
        <p className="mt-2 text-xs text-muted">The class changes with Move class, and the status with the suspension and leaving actions, so each change has a reason and an audit entry.</p>
      </Section>
      <Section title="Support">
        <div className="flex flex-col gap-1">
          <Checkbox label="BEAM beneficiary" checked={f.isBeam} onChange={(v) => set('isBeam', v)} />
          <FormGrid>
            <Input id="sp" label="Sponsor" value={f.sponsorName} onChange={(e) => set('sponsorName', e.target.value)} />
            <Select id="or" label="Orphan status" value={f.orphanStatus} onChange={(e) => set('orphanStatus', e.target.value as EditableStudent['orphanStatus'])} options={[{ value: 'NONE', label: 'Not an orphan' }, { value: 'SINGLE', label: 'Single orphan' }, { value: 'DOUBLE', label: 'Double orphan' }]} />
          </FormGrid>
          <Checkbox label="Has special educational needs" checked={f.specialNeeds} onChange={(v) => set('specialNeeds', v)} />
          {f.specialNeeds && s.canSeeNote && <TextArea id="sn-note" label="Note on the support needed" required rows={2} value={f.specialNeedsNote} onChange={(v) => set('specialNeedsNote', v)} error={errors.specialNeedsNote} />}
        </div>
      </Section>
      {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      <div className="flex gap-2"><Button type="submit" loading={busy}>Save</Button><Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button></div>
    </form>
  );
}
