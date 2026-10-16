'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { SchoolDefaultsSchema } from '@/lib/validations/system';

type FormInput = z.input<typeof SchoolDefaultsSchema>;
type FormOutput = z.output<typeof SchoolDefaultsSchema>;

export interface DefaultsValues {
  defaultCurrency: 'USD' | 'ZIG';
  maxClassSize: number;
  receiptPrefix: string | null;
  receiptNextNumber: number;
  setupChecklistPinned: boolean;
}

export function DefaultsTab({ school, canUpdate }: { school: DefaultsValues; canUpdate: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(SchoolDefaultsSchema),
    defaultValues: {
      defaultCurrency: school.defaultCurrency, maxClassSize: school.maxClassSize, receiptPrefix: school.receiptPrefix ?? '',
      receiptNextNumber: school.receiptNextNumber, setupChecklistPinned: school.setupChecklistPinned,
    },
  });

  async function save(values: FormOutput) {
    const res = await fetch('/api/system/settings/defaults', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('Defaults saved');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={!canUpdate} className="contents">
        <Card title="Defaults" subtitle="Other parts of Pfuma start from these">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              id="d-currency" label="Default currency" required error={errors.defaultCurrency?.message}
              options={[{ value: 'USD', label: 'US dollar (USD)' }, { value: 'ZIG', label: 'Zimbabwe Gold (ZiG)' }]}
              {...register('defaultCurrency')}
            />
            <Input id="d-size" label="Default class capacity" type="number" inputMode="numeric" min={1} max={200} required hint="Used for new classes" error={errors.maxClassSize?.message} {...register('maxClassSize', { valueAsNumber: true })} />
            <Input id="d-rprefix" label="Receipt prefix" placeholder="RCT" hint="Receipts read RCT-000001" error={errors.receiptPrefix?.message} {...register('receiptPrefix')} />
            <Input id="d-rnext" label="Next receipt number" type="number" inputMode="numeric" min={1} error={errors.receiptNextNumber?.message} {...register('receiptNextNumber', { valueAsNumber: true })} />
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink sm:col-span-2">
              <input type="checkbox" className="h-5 w-5 accent-primary" {...register('setupChecklistPinned')} />
              Keep the setup checklist on the dashboard even when every step is done
            </label>
          </div>
        </Card>
      </fieldset>
      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save defaults</Button>
        </div>
      ) : (
        <p className="text-sm text-muted">You can view these settings but not change them.</p>
      )}
    </form>
  );
}
