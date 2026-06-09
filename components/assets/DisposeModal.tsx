'use client';

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { DisposeAssetSchema } from '@/lib/validations/assets';

type FormValues = {
  disposalDate: string;
  reason:       string;
  method:       'SOLD' | 'SCRAPPED' | 'DONATED';
  proceeds?:    number;
  currency?:    'USD' | 'ZIG';
};

const METHOD_OPTIONS = [
  { value: 'SOLD',     label: 'Sold'     },
  { value: 'SCRAPPED', label: 'Scrapped' },
  { value: 'DONATED',  label: 'Donated'  },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'ZIG', label: 'ZiG' },
];

interface Props {
  assetId:   string;
  assetName: string;
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
}

export function DisposeModal({ assetId, assetName, open, onClose, onSuccess }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<'form' | 'confirm'>('form');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(DisposeAssetSchema) as unknown as Resolver<FormValues>,
    defaultValues: { method: 'SOLD', currency: 'USD' },
  });

  const formValues = watch();

  function handleClose() {
    reset();
    setStep('form');
    onClose();
  }

  function onFormValid(_values: FormValues) {
    setStep('confirm');
  }

  async function confirmDisposal() {
    const values = formValues;
    const res = await fetch(`/api/assets/${assetId}/dispose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        proceeds: values.proceeds != null ? Number(values.proceeds) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to record disposal');
      setStep('form');
      return;
    }
    toast.success('Asset disposed successfully');
    reset();
    setStep('form');
    onSuccess();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 'form' ? `Record Disposal — ${assetName}` : 'Confirm Disposal'}
      size="md"
      footer={
        step === 'form' ? (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="danger" form="dispose-form" type="submit">
              Review Disposal
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep('form')} disabled={isSubmitting}>
              Back
            </Button>
            <Button variant="danger" onClick={confirmDisposal} loading={isSubmitting}>
              Confirm Disposal
            </Button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <form id="dispose-form" onSubmit={handleSubmit(onFormValid)} className="flex flex-col gap-4">
          <div className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
            This action is permanent. The asset will be marked as disposed and cannot be returned to service.
          </div>

          <Input
            id="disposalDate"
            label="Disposal Date"
            type="date"
            required
            error={errors.disposalDate?.message}
            {...register('disposalDate')}
          />

          <Select
            id="method"
            label="Disposal Method"
            required
            options={METHOD_OPTIONS}
            error={errors.method?.message}
            {...register('method')}
          />

          <Input
            id="reason"
            label="Reason"
            required
            placeholder="e.g. Beyond economic repair"
            error={errors.reason?.message}
            {...register('reason')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="proceeds"
              label="Proceeds (optional)"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              hint="Only for sold assets"
              error={errors.proceeds?.message}
              {...register('proceeds', { valueAsNumber: true })}
            />
            <Select
              id="dispose-currency"
              label="Currency"
              options={CURRENCY_OPTIONS}
              error={errors.currency?.message}
              {...register('currency')}
            />
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
            You are about to permanently dispose of <strong>{assetName}</strong>. This cannot be undone.
          </div>

          <div className="divide-y divide-[#e7e5e4] rounded-lg border border-[#e7e5e4]">
            {[
              { label: 'Asset',    value: assetName },
              { label: 'Method',   value: formValues.method },
              { label: 'Date',     value: formValues.disposalDate ? String(formValues.disposalDate) : '—' },
              { label: 'Reason',   value: formValues.reason || '—' },
              {
                label: 'Proceeds',
                value: formValues.proceeds
                  ? `${formValues.currency ?? 'USD'} ${Number(formValues.proceeds).toFixed(2)}`
                  : '—',
              },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</span>
                <span className="text-sm font-medium text-[#292524]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
