'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { BOARDING_TYPES, GENDER_TYPES, PROVINCES, SCHOOL_TYPES, SchoolProfileSchema } from '@/lib/validations/system';

type FormInput = z.input<typeof SchoolProfileSchema>;
type FormOutput = z.output<typeof SchoolProfileSchema>;

export interface ProfileValues {
  name: string;
  motto: string | null;
  logoUrl: string | null;
  schoolType: (typeof SCHOOL_TYPES)[number];
  responsibleAuthority: string | null;
  boarding: (typeof BOARDING_TYPES)[number];
  studentGender: (typeof GENDER_TYPES)[number];
  offersCambridge: boolean;
  zimsecCentreNumber: string | null;
  emisNumber: string | null;
  province: string | null;
  district: string | null;
  physicalAddress: string | null;
  postalAddress: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  headName: string | null;
  headSignatureUrl: string | null;
  setupChecklistPinned: boolean;
}

const TYPE_LABELS = { GOVERNMENT: 'Government', COUNCIL: 'Council', MISSION_CHURCH: 'Mission / Church', TRUST: 'Trust', PRIVATE: 'Private' } as const;
const BOARDING_LABELS = { DAY: 'Day', BOARDING: 'Boarding', DAY_AND_BOARDING: 'Day and Boarding' } as const;
const GENDER_LABELS = { BOYS: 'Boys', GIRLS: 'Girls', CO_ED: 'Co-educational' } as const;
const opts = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));

/** Brings the dashboard's setup checklist back after every step is done. Saves as soon as it is ticked. */
function ChecklistSwitch({ pinned, canUpdate }: { pinned: boolean; canUpdate: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(pinned);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(pinned), [pinned]);

  async function change(next: boolean) {
    setBusy(true);
    setValue(next);
    try {
      const res = await fetch('/api/system/settings/defaults', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupChecklistPinned: next }) });
      if (!res.ok) { setValue(!next); toast.error((await res.json()).message ?? 'Could not save'); return; }
      toast.success(next ? 'The setup checklist will stay on the dashboard' : 'The setup checklist hides when every step is done');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Dashboard">
      <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={value} disabled={!canUpdate || busy} onChange={(e) => change(e.target.checked)} />
        Show the setup checklist on the dashboard even when every step is done
      </label>
    </Card>
  );
}

export function ProfileTab({ school, canUpdate }: { school: ProfileValues; canUpdate: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting, isDirty } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(SchoolProfileSchema),
    defaultValues: {
      name: school.name, motto: school.motto ?? '', logoUrl: school.logoUrl ?? '', schoolType: school.schoolType,
      responsibleAuthority: school.responsibleAuthority ?? '', boarding: school.boarding, studentGender: school.studentGender,
      offersCambridge: school.offersCambridge, zimsecCentreNumber: school.zimsecCentreNumber ?? '', emisNumber: school.emisNumber ?? '',
      province: (school.province ?? '') as FormInput['province'], district: school.district ?? '', physicalAddress: school.physicalAddress ?? '',
      postalAddress: school.postalAddress ?? '', phone: school.phone ?? '', email: school.email ?? '', website: school.website ?? '',
      headName: school.headName ?? '', headSignatureUrl: school.headSignatureUrl ?? '',
    },
  });
  const logoUrl = watch('logoUrl') || '';
  const signatureUrl = watch('headSignatureUrl') || '';

  async function save(values: FormOutput) {
    const res = await fetch('/api/system/settings/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('School profile saved');
    router.refresh();
  }

  const image = (field: 'logoUrl' | 'headSignatureUrl', endpoint: 'schoolLogo' | 'headSignature', current: string, alt: string) =>
    canUpdate ? (
      <div>
        <FileUpload endpoint={endpoint} existingUrl={current || undefined} onUpload={(url) => setValue(field, url, { shouldDirty: true, shouldValidate: true })} />
        {current && (
          <button type="button" onClick={() => setValue(field, '', { shouldDirty: true })} className="mt-1 min-h-[44px] text-xs font-medium text-danger hover:underline">
            Remove
          </button>
        )}
        {errors[field]?.message && <p role="alert" className="text-xs text-danger">{errors[field]?.message}</p>}
      </div>
    ) : current ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={current} alt={alt} className="h-16 max-w-[200px] object-contain" />
    ) : (
      <p className="text-sm text-muted">None uploaded.</p>
    );

  return (
    <div className="flex flex-col gap-4">
    <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={!canUpdate} className="contents">
        <Card title="Identity" subtitle="Printed on report cards and receipts">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input id="s-name" label="School name" required maxLength={120} error={errors.name?.message} {...register('name')} />
            <Input id="s-motto" label="Motto" maxLength={150} error={errors.motto?.message} {...register('motto')} />
            <Select id="s-type" label="School type" required options={opts(SCHOOL_TYPES, TYPE_LABELS)} error={errors.schoolType?.message} {...register('schoolType')} />
            <Input id="s-auth" label="Responsible authority" placeholder="e.g. Harare City Council" maxLength={120} error={errors.responsibleAuthority?.message} {...register('responsibleAuthority')} />
            <Select id="s-boarding" label="Boarding" required options={opts(BOARDING_TYPES, BOARDING_LABELS)} error={errors.boarding?.message} {...register('boarding')} />
            <Select id="s-gender" label="Gender" required options={opts(GENDER_TYPES, GENDER_LABELS)} error={errors.studentGender?.message} {...register('studentGender')} />
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-ink">Exam boards</legend>
              <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                <input type="checkbox" checked disabled readOnly className="h-5 w-5 accent-primary" /> ZIMSEC <span className="text-xs text-muted">always on</span>
              </label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                <input type="checkbox" className="h-5 w-5 accent-primary" {...register('offersCambridge')} /> Cambridge
              </label>
            </fieldset>
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Logo</p>
              <p className="mb-1.5 text-xs text-muted">PNG or JPG, up to 1 MB</p>
              {image('logoUrl', 'schoolLogo', logoUrl, 'School logo')}
            </div>
          </div>
        </Card>

        <Card title="Registration and location">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input id="s-centre" label="ZIMSEC centre number" autoCapitalize="characters" error={errors.zimsecCentreNumber?.message} {...register('zimsecCentreNumber')} />
            <Input id="s-emis" label="EMIS number" error={errors.emisNumber?.message} {...register('emisNumber')} />
            <Select id="s-province" label="Province" placeholder="Select a province" options={PROVINCES.map((p) => ({ value: p, label: p }))} error={errors.province?.message} {...register('province')} />
            <Input id="s-district" label="District" required maxLength={80} error={errors.district?.message} {...register('district')} />
          </div>
        </Card>

        <Card title="Contact">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Input id="s-phys" label="Physical address" required maxLength={250} error={errors.physicalAddress?.message} {...register('physicalAddress')} /></div>
            <div className="sm:col-span-2"><Input id="s-post" label="Postal address" placeholder="e.g. P O Box 123, Chinhoyi" maxLength={250} error={errors.postalAddress?.message} {...register('postalAddress')} /></div>
            <Input id="s-phone" label="Phone" type="tel" placeholder="0242 700123 or +263 77 123 4567" hint="Saved as +263…" error={errors.phone?.message} {...register('phone')} />
            <Input id="s-email" label="Email" type="email" error={errors.email?.message} {...register('email')} />
            <div className="sm:col-span-2"><Input id="s-web" label="Website" type="url" placeholder="https://www.school.co.zw" error={errors.website?.message} {...register('website')} /></div>
          </div>
        </Card>

        <Card title="Head of school" subtitle="Printed on report cards">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input id="s-head" label="Head's name" maxLength={100} error={errors.headName?.message} {...register('headName')} />
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Signature image</p>
              <p className="mb-1.5 text-xs text-muted">PNG or JPG, up to 1 MB</p>
              {image('headSignatureUrl', 'headSignature', signatureUrl, "Head's signature")}
            </div>
          </div>
        </Card>
      </fieldset>

      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save profile</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">You can view the school profile but not change it.</p>
      )}
    </form>
    <ChecklistSwitch pinned={school.setupChecklistPinned} canUpdate={canUpdate} />
    </div>
  );
}
