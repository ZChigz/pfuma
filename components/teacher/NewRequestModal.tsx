'use client';

import { useRef, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatZiG } from '@/lib/utils';
import { REQUEST_TYPE_LABELS } from '@/lib/expense-requests';
import { CreateExpenseRequestSchema } from '@/lib/validations/accounting';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateExpenseRequestSchema>;

const TYPE_OPTIONS = (['PURCHASE_ORDER', 'UTILITY_BILL', 'FUEL', 'MAINTENANCE', 'OTHER'] as const).map((t) => ({
  value: t,
  label: REQUEST_TYPE_LABELS[t],
}));

const EMPTY_ITEM = { description: '', quantity: 1, unitPrice: 0 };

const DEFAULT_VALUES: FormValues = {
  title: '',
  type: 'PURCHASE_ORDER',
  department: '',
  justification: '',
  currency: 'USD',
  items: [{ ...EMPTY_ITEM }],
};

export function NewRequestModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const actionRef = useRef<'draft' | 'submit'>('draft');

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateExpenseRequestSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const currency = watch('currency');
  const items = watch('items');
  const estimatedTotal = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0),
    0,
  );
  const formatTotal = currency === 'USD' ? formatUSD : formatZiG;

  function handleClose() {
    if (isSubmitting) return;
    setOpen(false);
    reset(DEFAULT_VALUES);
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/accounting/requests', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to create request');
      return;
    }

    if (actionRef.current === 'submit') {
      const submitRes = await fetch(`/api/accounting/requests/${data.data.request.id}/submit`, {
        method: 'POST',
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        toast.error(submitData.message ?? 'Saved as draft, but could not submit for approval');
        setOpen(false);
        reset(DEFAULT_VALUES);
        router.refresh();
        return;
      }
      toast.success('Request submitted for approval');
    } else {
      toast.success('Request saved as draft');
    }

    setOpen(false);
    reset(DEFAULT_VALUES);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>New request</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="New Expense Request"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              form="new-request-form"
              type="submit"
              variant="secondary"
              loading={isSubmitting}
              onClick={() => { actionRef.current = 'draft'; }}
            >
              Save as Draft
            </Button>
            <Button
              form="new-request-form"
              type="submit"
              loading={isSubmitting}
              onClick={() => { actionRef.current = 'submit'; }}
            >
              Submit for Approval
            </Button>
          </>
        }
      >
        <form id="new-request-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="title"
            label="Title"
            required
            placeholder="e.g. 5x Science laboratory chemicals"
            error={errors.title?.message}
            {...register('title')}
          />

          <Select
            id="type"
            label="Type"
            required
            options={TYPE_OPTIONS}
            error={errors.type?.message}
            {...register('type')}
          />

          <Input
            id="department"
            label="Department"
            required
            placeholder="e.g. Science Department"
            error={errors.department?.message}
            {...register('department')}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="justification" className="text-sm font-medium text-[#292524]">
              Justification<span className="ml-0.5 text-[#b91c1c]" aria-hidden="true">*</span>
            </label>
            <textarea
              id="justification"
              rows={3}
              placeholder="Why is this needed?"
              className="rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524] placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
              {...register('justification')}
            />
            {errors.justification?.message && (
              <p className="text-xs text-[#b91c1c]">{errors.justification.message}</p>
            )}
          </div>

          {/* Currency toggle */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[#292524]">Currency</span>
            <div className="flex gap-2">
              {(['USD', 'ZIG'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue('currency', c, { shouldValidate: true })}
                  className={`min-h-[44px] flex-1 rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                    currency === c
                      ? 'border-[#065f46] bg-[#065f46] text-white'
                      : 'border-[#e7e5e4] bg-white text-[#78716c] hover:border-[#065f46]/50 hover:bg-stone-50'
                  }`}
                >
                  {c === 'USD' ? 'USD' : 'ZiG'}
                </button>
              ))}
            </div>
          </div>

          {/* Line items */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#292524]">Line items</span>
            <div className="flex flex-col gap-3">
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-12 items-start gap-2">
                  <div className="col-span-12 sm:col-span-5">
                    <Input
                      placeholder="Description"
                      aria-label={`Item ${index + 1} description`}
                      error={errors.items?.[index]?.description?.message}
                      {...register(`items.${index}.description` as const)}
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Qty"
                      aria-label={`Item ${index + 1} quantity`}
                      error={errors.items?.[index]?.quantity?.message}
                      {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Unit price"
                      aria-label={`Item ${index + 1} unit price`}
                      error={errors.items?.[index]?.unitPrice?.message}
                      {...register(`items.${index}.unitPrice` as const, { valueAsNumber: true })}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 flex min-h-[44px] items-center text-sm font-medium tabular-nums text-[#292524]">
                    {formatTotal((Number(items[index]?.quantity) || 0) * (Number(items[index]?.unitPrice) || 0))}
                  </div>
                  <div className="col-span-1 flex min-h-[44px] items-center">
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Remove item ${index + 1}`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-[#78716c] hover:bg-stone-100 hover:text-[#b91c1c]"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 112 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {errors.items?.message && (
              <p className="text-xs text-[#b91c1c]">{errors.items.message}</p>
            )}
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => append({ ...EMPTY_ITEM })}>
              Add item
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-[#e7e5e4] pt-3">
            <span className="text-sm font-semibold text-[#292524]">Estimated total</span>
            <span className="text-lg font-bold tabular-nums text-[#292524]">{formatTotal(estimatedTotal)}</span>
          </div>
        </form>
      </Modal>
    </>
  );
}
