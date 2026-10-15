'use client';

import { useState } from 'react';
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
import { SchoolSettingsSchema } from '@/lib/validations/system';

type FormInput = z.input<typeof SchoolSettingsSchema>;
type FormOutput = z.output<typeof SchoolSettingsSchema>;

export interface SchoolProfile {
  name: string;
  schoolType: 'GOVERNMENT' | 'PRIVATE';
  location: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  motto: string | null;
  logoUrl: string | null;
  defaultCurrency: 'USD' | 'ZIG';
  maxClassSize: number;
}

export function SettingsForm({ school, canUpdate }: { school: SchoolProfile; canUpdate: boolean }) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(school.logoUrl ?? '');
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(SchoolSettingsSchema),
    defaultValues: {
      name: school.name, schoolType: school.schoolType, location: school.location ?? '', address: school.address ?? '',
      phone: school.phone ?? '', email: school.email ?? '', motto: school.motto ?? '', logoUrl: school.logoUrl ?? '',
      defaultCurrency: school.defaultCurrency, maxClassSize: school.maxClassSize,
    },
  });

  async function save(values: FormOutput) {
    const res = await fetch('/api/system/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, logoUrl }),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('School settings saved');
    router.refresh();
  }

  const locked = !canUpdate;

  return (
    <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
      <Card title="School profile" subtitle="Shown in the top bar and on printed documents">
        <fieldset disabled={locked} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input id="s-name" label="School name" required error={errors.name?.message} {...register('name')} />
          <Select
            id="s-type" label="Type" required error={errors.schoolType?.message}
            options={[{ value: 'GOVERNMENT', label: 'Government' }, { value: 'PRIVATE', label: 'Private' }]}
            {...register('schoolType')}
          />
          <Input id="s-location" label="Town or district" error={errors.location?.message} {...register('location')} />
          <Input id="s-motto" label="Motto" error={errors.motto?.message} {...register('motto')} />
          <div className="sm:col-span-2"><Input id="s-address" label="Postal or street address" error={errors.address?.message} {...register('address')} /></div>
          <Input id="s-phone" label="Phone" type="tel" placeholder="+263 242 123456" error={errors.phone?.message} {...register('phone')} />
          <Input id="s-email" label="Email" type="email" error={errors.email?.message} {...register('email')} />
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-ink">Logo</p>
            {canUpdate ? (
              <FileUpload endpoint="schoolLogo" existingUrl={logoUrl || undefined} onUpload={(url) => setLogoUrl(url)} />
            ) : logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="School logo" className="h-16 w-16 rounded-full object-contain" />
            ) : (
              <p className="text-sm text-muted">No logo uploaded.</p>
            )}
            {canUpdate && logoUrl && (
              <button type="button" onClick={() => setLogoUrl('')} className="mt-1 min-h-[44px] text-xs font-medium text-danger hover:underline">Remove logo</button>
            )}
          </div>
        </fieldset>
      </Card>

      <Card title="Defaults">
        <fieldset disabled={locked} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="s-currency" label="Default currency" required error={errors.defaultCurrency?.message}
            options={[{ value: 'USD', label: 'US dollar (USD)' }, { value: 'ZIG', label: 'Zimbabwe Gold (ZiG)' }]}
            {...register('defaultCurrency')}
          />
          <Input
            id="s-size" label="Default class capacity" type="number" inputMode="numeric" min={1} max={200} required
            hint="Used for new classes" error={errors.maxClassSize?.message}
            {...register('maxClassSize', { valueAsNumber: true })}
          />
        </fieldset>
      </Card>

      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty && logoUrl === (school.logoUrl ?? '')}>Save settings</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">You can view these settings but not change them.</p>
      )}
    </form>
  );
}
