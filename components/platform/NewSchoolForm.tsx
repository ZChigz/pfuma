'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { buildWhatsAppLink } from '@/lib/utils';
import { PRESETS } from '@/lib/platform/presets';
import { PROVINCES, SCHOOL_TYPES } from '@/lib/validations/system';

const TYPE_LABEL: Record<string, string> = { GOVERNMENT: 'Government', COUNCIL: 'Council', MISSION_CHURCH: 'Mission / church', TRUST: 'Trust', PRIVATE: 'Private' };

interface Invite { role: 'OWNER' | 'ADMINISTRATOR'; fullName: string; email: string; phone: string; url: string }
interface Created { school: { id: string; name: string }; invites: Invite[] }

const blankPerson = { fullName: '', email: '', phone: '' };

export function NewSchoolForm({ plans }: { plans: { id: string; name: string; key: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ name: '', schoolType: 'GOVERNMENT', province: '', preset: 'GOVERNMENT_DAY', planId: plans.find((p) => p.key === 'STANDARD')?.id ?? '', studentLimit: '', status: 'TRIAL', renewalDate: '' });
  const [owner, setOwner] = useState(blankPerson);
  const [administrator, setAdministrator] = useState(blankPerson);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch('/api/platform/schools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, studentLimit: f.studentLimit === '' ? null : Number(f.studentLimit), owner, administrator }),
      });
      const body = await res.json();
      if (!res.ok) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries((body.errors ?? {}) as Record<string, string[]>)) flat[k] = v[0];
        setErrors(flat);
        toast.error(body.errors ? 'Please check the form' : body.message ?? 'Could not create the school');
        return;
      }
      setCreated(body.data);
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.info('Copied'), () => toast.error('Could not copy'));
  const message = (i: Invite) => `Hello ${i.fullName}, you have been added as ${i.role === 'OWNER' ? 'the Owner' : 'the Administrator'} of ${created?.school.name} on Pfuma. Choose your password here (the link works for 72 hours): ${i.url}`;

  const person = (label: string, value: typeof blankPerson, setValue: (v: typeof blankPerson) => void, key: 'owner' | 'administrator') => (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3">
      <legend className="px-1 text-sm font-medium text-ink">{label}</legend>
      <Input id={`${key}-name`} label="Full name" required value={value.fullName} onChange={(e) => setValue({ ...value, fullName: e.target.value })} error={errors[`${key}.fullName`] ?? errors[key]} />
      <Input id={`${key}-email`} label="Email" type="email" required value={value.email} onChange={(e) => setValue({ ...value, email: e.target.value })} error={errors[`${key}.email`]} />
      <Input id={`${key}-phone`} label="Mobile number" type="tel" required placeholder="0771 234 567" value={value.phone} onChange={(e) => setValue({ ...value, phone: e.target.value })} error={errors[`${key}.phone`]} />
    </fieldset>
  );

  return (
    <>
      <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-4 rounded-2xl bg-white p-5" aria-label="New school">
        <Input id="s-name" label="School name" required value={f.name} onChange={set('name')} error={errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="s-type" label="Type" required options={SCHOOL_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} value={f.schoolType} onChange={set('schoolType')} error={errors.schoolType} />
          <Select id="s-province" label="Province" required placeholder="Choose" options={PROVINCES.map((p) => ({ value: p, label: p }))} value={f.province} onChange={set('province')} error={errors.province} />
        </div>
        <Select id="s-preset" label="Preset" required hint="Sets which modules are on. You can change each one afterwards." options={Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label }))} value={f.preset} onChange={set('preset')} error={errors.preset} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="s-plan" label="Plan" options={plans.map((p) => ({ value: p.id, label: p.name }))} value={f.planId} onChange={set('planId')} error={errors.planId} />
          <Input id="s-limit" label="Student limit" type="number" min={1} inputMode="numeric" hint="Leave empty for no limit" value={f.studentLimit} onChange={set('studentLimit')} error={errors.studentLimit} />
          <Select id="s-status" label="Starts as" options={[{ value: 'TRIAL', label: 'Trial' }, { value: 'ACTIVE', label: 'Active' }]} value={f.status} onChange={set('status')} />
          <Input id="s-renew" label="Renewal date" type="date" value={f.renewalDate} onChange={set('renewalDate')} error={errors.renewalDate} />
        </div>
        {person('First Owner', owner, setOwner, 'owner')}
        {person('First Administrator', administrator, setAdministrator, 'administrator')}
        {errors.administrator && <p role="alert" className="text-xs text-danger">{errors.administrator}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>Create school and invites</Button>
          <Link href="/platform" className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Cancel</Link>
        </div>
      </form>

      <Modal open={created !== null} onClose={() => { const id = created?.school.id; setCreated(null); if (id) router.push(`/platform/schools/${id}`); }} title={`${created?.school.name ?? ''} is ready`} size="lg" footer={<Button onClick={() => { const id = created?.school.id; setCreated(null); if (id) router.push(`/platform/schools/${id}`); }}>Open the school</Button>}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Give each person their link. It works once and for 72 hours, and they choose their own password with it. The links are shown only now. Pfuma does not send e-mail or SMS by itself yet.</p>
          {created?.invites.map((i) => (
            <section key={i.role} aria-label={`${i.role} invite`} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <p className="text-sm font-semibold text-ink">{i.role === 'OWNER' ? 'Owner' : 'Administrator'}: {i.fullName}</p>
              <input readOnly aria-label={`${i.fullName} invite link`} value={i.url} onFocus={(e) => e.currentTarget.select()} className="min-h-[44px] w-full rounded-xl border border-line bg-rowhover px-3 font-mono text-xs text-primary" />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => copy(i.url)}>Copy link</Button>
                <a href={buildWhatsAppLink(i.phone, message(i))} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Send on WhatsApp</a>
                <a href={`mailto:${i.email}?subject=${encodeURIComponent('Your Pfuma account')}&body=${encodeURIComponent(message(i))}`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Send by email</a>
              </div>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
