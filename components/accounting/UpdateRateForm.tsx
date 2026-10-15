'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

const Schema = z.object({
  usdToZig: z
    .number({ error: 'Please enter a rate' })
    .positive('Rate must be positive'),
  note: z.string().optional(),
  effectiveFrom: z.string().optional(),
  source: z.enum(['RBZ', 'SCHOOL', 'OTHER']),
});

type FormValues = z.infer<typeof Schema>;

interface Props {
  currentRate: number | null;
}

export function UpdateRateForm({ currentRate }: Props) {
  const toast  = useToast();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { usdToZig: currentRate ?? undefined, note: '', effectiveFrom: '', source: 'SCHOOL' },
  });

  async function onSubmit(values: FormValues) {
    const res  = await fetch('/api/accounting/exchange-rate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...values, effectiveFrom: values.effectiveFrom ? new Date(values.effectiveFrom).toISOString() : undefined }),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.message ?? 'Failed to set rate');
      return;
    }
    toast.success('Exchange rate updated');
    reset({ usdToZig: values.usdToZig, note: '', effectiveFrom: '', source: values.source });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Input
        id="usdToZig"
        label="ZiG per 1 USD"
        type="number"
        step="0.01"
        min="0.01"
        required
        placeholder="e.g. 25.50"
        error={errors.usdToZig?.message}
        {...register('usdToZig', { valueAsNumber: true })}
      />
      <Input
        id="effectiveFrom"
        label="Effective from (leave empty for now)"
        type="datetime-local"
        {...register('effectiveFrom')}
      />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Source
        <select {...register('source')} className="min-h-[44px] rounded-xl border border-line bg-canvas px-3 text-sm font-normal">
          <option value="SCHOOL">School</option>
          <option value="RBZ">RBZ</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <p className="-mt-2 text-xs text-muted">Rates are history and cannot be edited. To correct a mistake, enter a new rate.</p>
      <Input
        id="note"
        label="Note (optional)"
        placeholder="e.g. RBZ rate 09 June 2026"
        error={errors.note?.message}
        {...register('note')}
      />
      <Button type="submit" loading={isSubmitting}>
        Set Rate
      </Button>
    </form>
  );
}
