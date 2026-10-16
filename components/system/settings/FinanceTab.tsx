'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { previewNumber } from '@/lib/numbering';
import { FinanceSettingsSchema } from '@/lib/validations/system';

type FormInput = z.input<typeof FinanceSettingsSchema>;
type FormOutput = z.output<typeof FinanceSettingsSchema>;

export interface FinanceValues {
  currencyUsdEnabled: boolean;
  currencyZigEnabled: boolean;
  defaultCurrency: 'USD' | 'ZIG';
  receiptFormat: string | null;
  receiptNextNumber: number;
  invoiceFormat: string | null;
  invoiceNextNumber: number;
  schoolCode: string;
}

export const SUGGESTED_RECEIPT_FORMAT = 'RCP-{YEAR}-{000000}';
export const SUGGESTED_INVOICE_FORMAT = 'INV-{YEAR}-{000000}';

export function FinanceTab({ school, year, canUpdate }: { school: FinanceValues; year: number; canUpdate: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting, isDirty } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(FinanceSettingsSchema),
    defaultValues: {
      currencyUsdEnabled: school.currencyUsdEnabled, currencyZigEnabled: school.currencyZigEnabled, defaultCurrency: school.defaultCurrency,
      receiptFormat: school.receiptFormat ?? SUGGESTED_RECEIPT_FORMAT, receiptNextNumber: school.receiptNextNumber,
      invoiceFormat: school.invoiceFormat ?? SUGGESTED_INVOICE_FORMAT, invoiceNextNumber: school.invoiceNextNumber,
    },
  });
  const usd = watch('currencyUsdEnabled');
  const zig = watch('currencyZigEnabled');
  const first = watch('defaultCurrency');
  const ctx = { year, schoolCode: school.schoolCode };
  const receiptPreview = previewNumber(String(watch('receiptFormat') ?? ''), ctx, Number(watch('receiptNextNumber')) || 1);
  const invoicePreview = previewNumber(String(watch('invoiceFormat') ?? ''), ctx, Number(watch('invoiceNextNumber')) || 1);

  // Switching a currency off moves "shown first" to the other one rather than leaving an impossible choice.
  function toggle(which: 'currencyUsdEnabled' | 'currencyZigEnabled', on: boolean) {
    setValue(which, on, { shouldDirty: true, shouldValidate: true });
    if (!on && ((which === 'currencyUsdEnabled' && first === 'USD') || (which === 'currencyZigEnabled' && first === 'ZIG'))) {
      setValue('defaultCurrency', which === 'currencyUsdEnabled' ? 'ZIG' : 'USD', { shouldDirty: true, shouldValidate: true });
    }
  }

  async function save(values: FormOutput) {
    const res = await fetch('/api/system/settings/finance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('Finance basics saved');
    router.refresh();
  }

  const formatHelp = 'Write the number as zeros, such as {000000}. Other tokens: {YEAR}, {YY}, {SCHOOLCODE}.';

  return (
    <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
      <fieldset disabled={!canUpdate} className="contents">
        <Card title="Currencies in use" subtitle="Both are on by default">
          <div className="flex flex-col gap-1">
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-primary" checked={usd} onChange={(e) => toggle('currencyUsdEnabled', e.target.checked)} /> US dollar (USD)
            </label>
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-primary" checked={zig} onChange={(e) => toggle('currencyZigEnabled', e.target.checked)} /> Zimbabwe Gold (ZiG)
            </label>
            {errors.currencyUsdEnabled?.message && <p role="alert" className="text-xs text-danger">{errors.currencyUsdEnabled.message}</p>}
            <fieldset className="mt-2">
              <legend className="mb-1 text-sm font-medium text-ink">Shown first</legend>
              <div className="flex gap-4">
                {([['USD', usd], ['ZIG', zig]] as const).map(([c, on]) => (
                  <label key={c} className={`flex min-h-[44px] items-center gap-2 text-sm ${on ? 'text-ink' : 'text-subtle'}`}>
                    <input type="radio" value={c} disabled={!on} className="h-5 w-5 accent-primary" {...register('defaultCurrency')} /> {c === 'ZIG' ? 'ZiG' : 'USD'}
                  </label>
                ))}
              </div>
              {errors.defaultCurrency?.message && <p role="alert" className="text-xs text-danger">{errors.defaultCurrency.message}</p>}
            </fieldset>
          </div>
        </Card>

        <Card title="Receipt numbers" subtitle={formatHelp}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input id="f-rformat" label="Receipt format" required error={errors.receiptFormat?.message} {...register('receiptFormat')} />
            <Input id="f-rnext" label="Next receipt number" type="number" inputMode="numeric" min={1} required error={errors.receiptNextNumber?.message} {...register('receiptNextNumber', { valueAsNumber: true })} />
          </div>
          <p className="mt-3 text-sm text-muted" aria-live="polite">Next receipt: <strong className="font-mono text-ink">{receiptPreview ?? 'check the format'}</strong></p>
        </Card>

        <Card title="Invoice numbers">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input id="f-iformat" label="Invoice format" required error={errors.invoiceFormat?.message} {...register('invoiceFormat')} />
            <Input id="f-inext" label="Next invoice number" type="number" inputMode="numeric" min={1} required error={errors.invoiceNextNumber?.message} {...register('invoiceNextNumber', { valueAsNumber: true })} />
          </div>
          <p className="mt-3 text-sm text-muted" aria-live="polite">Next invoice: <strong className="font-mono text-ink">{invoicePreview ?? 'check the format'}</strong></p>
        </Card>
      </fieldset>

      {canUpdate ? (
        <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty && !!school.receiptFormat && !!school.invoiceFormat}>Save finance basics</Button></div>
      ) : (
        <p className="text-sm text-muted">You can view these settings but not change them.</p>
      )}
    </form>
  );
}
