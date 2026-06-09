'use client';

import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { CreateMaintenanceSchema } from '@/lib/validations/assets';

type FormValues = {
  maintenanceDate:  string;
  description:      string;
  cost?:            number;
  currency?:        'USD' | 'ZIG';
  provider?:        string;
  nextServiceDate?: string;
};

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

export function MaintenanceModal({ assetId, assetName, open, onClose, onSuccess }: Props) {
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateMaintenanceSchema) as unknown as Resolver<FormValues>,
    defaultValues: { currency: 'USD' },
  });

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/assets/${assetId}/maintenance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        cost: values.cost != null ? Number(values.cost) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to log maintenance');
      return;
    }
    toast.success('Maintenance record added');
    reset();
    onSuccess();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Log Maintenance — ${assetName}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button form="maintenance-form" type="submit" loading={isSubmitting}>
            Save Record
          </Button>
        </>
      }
    >
      <form id="maintenance-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Input
          id="maintenanceDate"
          label="Maintenance Date"
          type="date"
          required
          error={errors.maintenanceDate?.message}
          {...register('maintenanceDate')}
        />

        <Input
          id="description"
          label="Description"
          required
          placeholder="e.g. Replaced toner cartridge"
          error={errors.description?.message}
          {...register('description')}
        />

        <Input
          id="provider"
          label="Service Provider"
          placeholder="Optional — company or technician name"
          error={errors.provider?.message}
          {...register('provider')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="cost"
            label="Cost (optional)"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            error={errors.cost?.message}
            {...register('cost', { valueAsNumber: true })}
          />
          <Select
            id="currency"
            label="Currency"
            options={CURRENCY_OPTIONS}
            error={errors.currency?.message}
            {...register('currency')}
          />
        </div>

        <Input
          id="nextServiceDate"
          label="Next Service Date (optional)"
          type="date"
          error={errors.nextServiceDate?.message}
          {...register('nextServiceDate')}
        />
      </form>
    </Modal>
  );
}
