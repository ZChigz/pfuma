'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { CreateExpenseSchema } from '@/lib/validations/accounting';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateExpenseSchema>;

export const EXPENSE_CATEGORIES = [
  'Staff Salaries',
  'Fuel',
  'Canteen Groceries',
  'Utilities',
  'Stationery',
  'Maintenance',
] as const;

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }));

interface Props {
  onSuccess?: () => void;
}

export function ExpenseForm({ onSuccess }: Props) {
  const router = useRouter();
  const toast  = useToast();

  const today = new Date().toISOString().split('T')[0];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateExpenseSchema),
    defaultValues: { currency: 'USD', spentOn: today },
  });

  const currency = watch('currency');

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/accounting/expenses', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to log expense');
      return;
    }
    toast.success('Expense logged');
    reset({ currency: 'USD', spentOn: today });
    router.refresh();
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Select
        id="category"
        label="Category"
        required
        options={CATEGORY_OPTIONS}
        placeholder="Select category"
        error={errors.category?.message}
        {...register('category')}
      />

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

      <Input
        id="expense-amount"
        label="Amount"
        type="number"
        required
        min="0.01"
        step="0.01"
        placeholder="0.00"
        error={errors.amount?.message}
        {...register('amount', { valueAsNumber: true })}
      />

      <Input
        id="spentOn"
        label="Date"
        type="date"
        required
        error={errors.spentOn?.message}
        {...register('spentOn')}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-sm font-medium text-[#292524]">
          Note{' '}
          <span className="font-normal text-[#78716c]">(optional)</span>
        </label>
        <textarea
          id="note"
          rows={3}
          placeholder="Additional details…"
          className="rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524] placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
          {...register('note')}
        />
      </div>

      <Button type="submit" loading={isSubmitting} className="self-end">
        Log Expense
      </Button>
    </form>
  );
}
