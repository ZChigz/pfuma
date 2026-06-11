'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatZiG } from '@/lib/utils';
import { REQUEST_TYPE_LABELS } from '@/lib/expense-requests';
import { DisburseExpenseRequestSchema } from '@/lib/validations/accounting';
import type { Currency, ExpenseRequestType } from '@/types';
import type { z } from 'zod';

type FormValues = z.infer<typeof DisburseExpenseRequestSchema>;

const PAYMENT_METHODS = [
  { value: 'CASH',    label: 'Cash'    },
  { value: 'ECOCASH', label: 'EcoCash' },
  { value: 'SWIPE',   label: 'Swipe'   },
  { value: 'ZIPIT',   label: 'ZIPIT'   },
] as const;

export interface DisbursableRequest {
  id: string;
  requestNumber: string;
  title: string;
  department: string;
  type: ExpenseRequestType;
  currency: Currency;
  estimatedTotal: number;
}

export function DisburseModal({ request }: { request: DisbursableRequest }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const formatAmount = request.currency === 'USD' ? formatUSD : formatZiG;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(DisburseExpenseRequestSchema),
    defaultValues: {
      actualTotal:      request.estimatedTotal,
      paymentMethod:    'CASH',
      disbursementNote: '',
    },
  });

  const paymentMethod = watch('paymentMethod');

  function handleClose() {
    if (isSubmitting) return;
    setOpen(false);
    reset();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/accounting/requests/${request.id}/disburse`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to record disbursement');
      return;
    }
    toast.success('Disbursed. Expense recorded automatically.');
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Disburse</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title={`Disburse — ${request.requestNumber}`}
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="disburse-form" type="submit" loading={isSubmitting}>Confirm</Button>
          </>
        }
      >
        <form id="disburse-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-3 text-sm">
            <p className="font-medium text-[#292524]">{request.title}</p>
            <p className="mt-0.5 text-[#78716c]">{request.department} · {REQUEST_TYPE_LABELS[request.type]}</p>
            <p className="mt-1 text-[#78716c]">Estimated total: <span className="font-medium text-[#292524]">{formatAmount(request.estimatedTotal)}</span></p>
          </div>

          <Input
            id="actualTotal"
            label="Actual amount paid"
            type="number"
            required
            min="0.01"
            step="0.01"
            error={errors.actualTotal?.message}
            {...register('actualTotal', { valueAsNumber: true })}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[#292524]">Currency</span>
            <input
              type="text"
              readOnly
              value={request.currency === 'USD' ? 'USD' : 'ZiG'}
              className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-stone-50 px-3 py-2 text-sm text-[#78716c]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-[#292524]">Payment method</span>
            <div className="grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setValue('paymentMethod', m.value, { shouldValidate: true })}
                  className={`min-h-[44px] rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                    paymentMethod === m.value
                      ? 'border-[#065f46] bg-[#065f46] text-white'
                      : 'border-[#e7e5e4] bg-white text-[#78716c] hover:border-[#065f46]/50 hover:bg-stone-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="disbursementNote" className="text-sm font-medium text-[#292524]">
              Note <span className="font-normal text-[#78716c]">(optional)</span>
            </label>
            <textarea
              id="disbursementNote"
              rows={2}
              placeholder="Additional details…"
              className="rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524] placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
              {...register('disbursementNote')}
            />
          </div>

          <p className="text-xs text-[#78716c]">This will create an expense entry in the ledger.</p>
        </form>
      </Modal>
    </>
  );
}
