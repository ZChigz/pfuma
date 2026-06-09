'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { CreateChargeSchema } from '@/lib/validations/accounting';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateChargeSchema>;

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'ZIG', label: 'ZiG — Zimbabwe Gold' },
];

interface Props {
  studentId: string;
}

export function ApplyChargeModal({ studentId }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const defaultValues: Partial<FormValues> = {
    studentId,
    currency: 'USD',
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateChargeSchema),
    defaultValues,
  });

  function handleClose() {
    setOpen(false);
    reset(defaultValues);
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/accounting/students/${studentId}/charges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to apply charge');
      return;
    }
    toast.success('Charge applied');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Apply Charge
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Apply Charge"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="apply-charge-form" type="submit" loading={isSubmitting}>
              Apply
            </Button>
          </>
        }
      >
        <form id="apply-charge-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <input type="hidden" {...register('studentId')} />

          <Input
            id="label"
            label="Fee Label"
            required
            placeholder="e.g. Term 1 School Fees"
            error={errors.label?.message}
            {...register('label')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              id="currency"
              label="Currency"
              required
              options={CURRENCY_OPTIONS}
              error={errors.currency?.message}
              {...register('currency')}
            />
            <Input
              id="amount"
              label="Amount"
              type="number"
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
              error={errors.amount?.message}
              {...register('amount', { valueAsNumber: true })}
            />
          </div>

          <Input
            id="term"
            label="Term"
            required
            placeholder="e.g. Term 1 2026"
            error={errors.term?.message}
            {...register('term')}
          />
        </form>
      </Modal>
    </>
  );
}
