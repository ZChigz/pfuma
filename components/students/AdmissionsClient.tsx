'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { api, fieldMessages, formatDay, FormGrid, problem, Section, TextArea, useBusy } from '@/components/students/shared';

export interface IntakeRow {
  id: string; name: string; levelId: string; level: string; year: number; places: number; closed: boolean; applicationFee: number; feeCurrency: string;
  applicationOpens: string | null; applicationCloses: string | null; testDate: string | null; reportingDate: string | null; requirements: string[];
  applications: number; offers: number; enrolled: number;
}

export function IntakesClient({ intakes, levels, canManage }: { intakes: IntakeRow[]; levels: { id: string; name: string }[]; canManage: boolean }) {
  const [editing, setEditing] = useState<IntakeRow | 'new' | null>(null);
  const router = useRouter();
  return (
    <Section title={`Intakes (${intakes.length})`} action={canManage && <Button size="sm" onClick={() => setEditing('new')}>New intake</Button>}>
      {intakes.length === 0 ? <p className="text-sm text-muted">No intakes yet. Make one, for example “Form 1, 2027”, with its places and dates.</p> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {intakes.map((i) => (
            <li key={i.id} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/students/admissions/${i.id}`} className="text-base font-semibold text-primary hover:underline">{i.name}</Link>
                {canManage && <button type="button" onClick={() => setEditing(i)} className="min-h-[44px] px-2 text-xs font-semibold text-primary underline">Edit</button>}
              </div>
              <p className="text-xs text-muted">{i.level} · {i.places} places{i.closed ? ' · closed' : ''}{i.testDate ? ` · test ${formatDay(i.testDate)}` : ''}{i.reportingDate ? ` · reporting ${formatDay(i.reportingDate)}` : ''}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[['Applications', i.applications], ['Offers', i.offers], ['Enrolled', i.enrolled]].map(([k, v]) => <div key={k as string} className="rounded-lg bg-canvas py-2"><dt className="text-xs text-muted">{k}</dt><dd className="text-xl font-bold text-ink">{v}</dd></div>)}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {editing && <IntakeModal intake={editing === 'new' ? null : editing} levels={levels} onClose={() => setEditing(null)} onDone={() => { setEditing(null); router.refresh(); }} />}
    </Section>
  );
}

function IntakeModal({ intake, levels, onClose, onDone }: { intake: IntakeRow | null; levels: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: intake?.name ?? '', levelId: intake?.levelId ?? '', year: String(intake?.year ?? new Date().getFullYear() + 1), places: String(intake?.places ?? ''), applicationOpens: intake?.applicationOpens ?? '',
    applicationCloses: intake?.applicationCloses ?? '', testDate: intake?.testDate ?? '', reportingDate: intake?.reportingDate ?? '', applicationFee: String(intake?.applicationFee ?? 0),
    feeCurrency: intake?.feeCurrency ?? 'USD', requirements: (intake?.requirements ?? []).join('\n'), closed: intake?.closed ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useBusy();
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  async function submit() {
    const body = {
      name: f.name, levelId: f.levelId, year: Number(f.year), places: Number(f.places), applicationOpens: f.applicationOpens || undefined, applicationCloses: f.applicationCloses || undefined,
      testDate: f.testDate || undefined, reportingDate: f.reportingDate || undefined, applicationFee: Number(f.applicationFee) || 0, feeCurrency: f.feeCurrency,
      requirements: f.requirements.split('\n').map((x) => x.trim()).filter(Boolean), closed: f.closed,
    };
    const r = await run(() => api(intake ? `/api/students/admissions/${intake.id}` : '/api/students/admissions', intake ? 'PATCH' : 'POST', body));
    if (!r) return;
    if (!r.ok) { setErrors({ ...fieldMessages(r), form: problem(r) }); return; }
    toast.success(intake ? 'Intake saved' : 'Intake made');
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={intake ? `Edit ${intake.name}` : 'New intake'} size="lg" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!f.name || !f.levelId || !f.places}>Save</Button></>}>
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
        <Input id="in-name" label="Name" required placeholder="Form 1, 2027" value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
        <FormGrid>
          <Select id="in-level" label="Form" required placeholder="Choose" value={f.levelId} onChange={(e) => set('levelId', e.target.value)} options={levels.map((l) => ({ value: l.id, label: l.name }))} error={errors.levelId} />
          <Input id="in-year" type="number" label="Year" required value={f.year} onChange={(e) => set('year', e.target.value)} error={errors.year} />
          <Input id="in-places" type="number" min={1} label="Places available" required value={f.places} onChange={(e) => set('places', e.target.value)} error={errors.places} />
          <Input id="in-fee" type="number" min={0} step="0.01" label="Application fee" hint="Shown here; Finance collects it." value={f.applicationFee} onChange={(e) => set('applicationFee', e.target.value)} error={errors.applicationFee} />
          <Input id="in-open" type="date" label="Applications open" value={f.applicationOpens} onChange={(e) => set('applicationOpens', e.target.value)} />
          <Input id="in-close" type="date" label="Applications close" value={f.applicationCloses} onChange={(e) => set('applicationCloses', e.target.value)} error={errors.applicationCloses} />
          <Input id="in-test" type="date" label="Entrance test" value={f.testDate} onChange={(e) => set('testDate', e.target.value)} />
          <Input id="in-rep" type="date" label="Reporting date" value={f.reportingDate} onChange={(e) => set('reportingDate', e.target.value)} />
        </FormGrid>
        <TextArea id="in-req" label="Requirements list (one per line)" rows={4} value={f.requirements} onChange={(v) => set('requirements', v)} hint="Printed on the offer letter." />
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.closed} onChange={(e) => set('closed', e.target.checked)} /> Closed to new applications</label>
        {errors.form && <p role="alert" className="text-sm text-danger">{errors.form}</p>}
      </div>
    </Modal>
  );
}
