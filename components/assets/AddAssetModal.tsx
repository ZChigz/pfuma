'use client';

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FileUpload } from '@/components/ui/FileUpload';
import { useToast } from '@/components/ui/Toast';
import { CreateAssetSchema } from '@/lib/validations/assets';

type FormValues = {
  name:            string;
  categoryId:      string;
  description?:    string;
  tagNumber:       string;
  acquisitionDate: string;
  acquisitionCost: number;
  currency:        'USD' | 'ZIG';
  location:        string;
  custodian?:      string;
  condition:       'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CONDEMNED';
  imageUrl?:       string;
};

const CONDITION_OPTIONS = [
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD',      label: 'Good'      },
  { value: 'FAIR',      label: 'Fair'      },
  { value: 'POOR',      label: 'Poor'      },
  { value: 'CONDEMNED', label: 'Condemned' },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD' },
  { value: 'ZIG', label: 'ZiG' },
];

interface Props {
  categories: { id: string; name: string }[];
}

export function AddAssetModal({ categories }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssetSchema) as unknown as Resolver<FormValues>,
    defaultValues: { currency: 'USD', condition: 'GOOD' },
  });

  const imageUrl = watch('imageUrl');

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        acquisitionCost: Number(values.acquisitionCost),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to add asset');
      return;
    }
    toast.success('Asset added successfully');
    handleClose();
    router.refresh();
  }

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Asset</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Asset"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="add-asset-form" type="submit" loading={isSubmitting}>
              Add Asset
            </Button>
          </>
        }
      >
        <form id="add-asset-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="name"
              label="Asset Name"
              required
              placeholder="e.g. HP LaserJet Printer"
              error={errors.name?.message}
              {...register('name')}
            />
            <Select
              id="categoryId"
              label="Category"
              required
              options={categoryOptions}
              placeholder="Select category"
              error={errors.categoryId?.message}
              {...register('categoryId')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="tagNumber"
              label="Tag / Serial Number"
              required
              placeholder="e.g. TAG-001"
              error={errors.tagNumber?.message}
              {...register('tagNumber')}
            />
            <Input
              id="acquisitionDate"
              label="Acquisition Date"
              type="date"
              required
              error={errors.acquisitionDate?.message}
              {...register('acquisitionDate')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="acquisitionCost"
              label="Acquisition Cost"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder="0.00"
              error={errors.acquisitionCost?.message}
              {...register('acquisitionCost', { valueAsNumber: true })}
            />
            <Select
              id="currency"
              label="Currency"
              required
              options={CURRENCY_OPTIONS}
              error={errors.currency?.message}
              {...register('currency')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="location"
              label="Location"
              required
              placeholder="e.g. Admin Block, Room 3"
              error={errors.location?.message}
              {...register('location')}
            />
            <Input
              id="custodian"
              label="Custodian"
              placeholder="Responsible person (optional)"
              error={errors.custodian?.message}
              {...register('custodian')}
            />
          </div>

          <Select
            id="condition"
            label="Condition"
            required
            options={CONDITION_OPTIONS}
            error={errors.condition?.message}
            {...register('condition')}
          />

          <Input
            id="description"
            label="Description"
            placeholder="Optional notes about this asset"
            error={errors.description?.message}
            {...register('description')}
          />

          <FileUpload
            endpoint="assetImage"
            label="Asset Image (optional)"
            existingUrl={imageUrl || undefined}
            onUpload={(url) => setValue('imageUrl', url)}
          />
        </form>
      </Modal>
    </>
  );
}
