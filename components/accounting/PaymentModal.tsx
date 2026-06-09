'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FileUpload } from '@/components/ui/FileUpload';
import { useToast } from '@/components/ui/Toast';
import { CreatePaymentSchema } from '@/lib/validations/accounting';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreatePaymentSchema>;

export interface ReceiptData {
  id: string;
  feeLabel: string;
  currency: 'USD' | 'ZIG';
  amount: number;
  method: string;
  reference?: string;
  status: 'PENDING' | 'VERIFIED';
  recordedAt: string;
  schoolName: string;
  studentFullName: string;
  studentGrade: string;
  studentParentPhone: string;
  balanceUSD: number;
  balanceZiG: number;
  paidInZig?: boolean;
  zigAmountPaid?: number | null;
  exchangeRateUsed?: number | null;
}

export interface StudentForPayment {
  id: string;
  fullName: string;
  grade: string;
  parentPhone: string;
  balanceUSD: number;
  balanceZiG: number;
}

interface Props {
  open: boolean;
  student: StudentForPayment;
  onSuccess: (receipt: ReceiptData) => void;
  onClose: () => void;
}

const METHODS = [
  { value: 'CASH',    label: 'Cash'    },
  { value: 'ECOCASH', label: 'EcoCash' },
  { value: 'SWIPE',   label: 'Swipe'   },
  { value: 'ZIPIT',   label: 'ZIPIT'   },
] as const;

export function PaymentModal({ open, student, onSuccess, onClose }: Props) {
  const toast = useToast();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreatePaymentSchema),
    defaultValues: {
      studentId:        student.id,
      currency:         'USD',
      method:           'CASH',
      amount:           undefined,
      reference:        '',
      feeLabel:         '',
      popUrl:           '',
      paidInZig:        false,
      zigAmountPaid:    undefined,
      exchangeRateUsed: undefined,
    },
  });

  const currency  = watch('currency');
  const method    = watch('method');
  const amount    = watch('amount');
  const isNonCash = method !== 'CASH';

  const [exchangeRate, setExchangeRate] = useState<{
    usdToZig: number;
    createdAt?: string;
  } | null>(null);

  const [paidInZig, setPaidInZig]           = useState(false);
  const [zigAmountInput, setZigAmountInput] = useState<number | undefined>(undefined);

  useEffect(() => {
    fetch('/api/accounting/exchange-rate')
      .then((r) => r.json())
      .then((body) => {
        if (body.success && body.data.rate) {
          setExchangeRate({
            usdToZig:  body.data.rate.usdToZig,
            createdAt: body.data.rate.createdAt,
          });
        }
      })
      .catch(() => {});
  }, []);

  function handleZigToggle() {
    const next = !paidInZig;
    setPaidInZig(next);
    setZigAmountInput(undefined);
    setValue('amount',           undefined as unknown as number);
    setValue('zigAmountPaid',    undefined);
    setValue('exchangeRateUsed', undefined);
    if (next) {
      setValue('paidInZig', true);
      setValue('currency',  'USD', { shouldValidate: true });
    } else {
      setValue('paidInZig', false);
    }
  }

  function handleZigInput(val: number | undefined) {
    setZigAmountInput(val);
    if (val && val > 0 && exchangeRate) {
      const usd = Math.round((val / exchangeRate.usdToZig) * 100) / 100;
      setValue('amount',           usd, { shouldValidate: true });
      setValue('zigAmountPaid',    val);
      setValue('exchangeRateUsed', exchangeRate.usdToZig);
    } else {
      setValue('amount',           undefined as unknown as number);
      setValue('zigAmountPaid',    undefined);
      setValue('exchangeRateUsed', undefined);
    }
  }

  const outstandingHint = currency === 'USD'
    ? `Outstanding: ${formatUSD(student.balanceUSD)}`
    : `Outstanding: ${formatZiG(student.balanceZiG)}`;

  function handleClose() {
    reset();
    setPaidInZig(false);
    setZigAmountInput(undefined);
    onClose();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/accounting/payments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(values),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.message ?? 'Failed to record payment');
      return;
    }

    const { payment, schoolName } = body.data;
    const receipt: ReceiptData = {
      id:                 payment.id,
      feeLabel:           payment.feeLabel,
      currency:           payment.currency,
      amount:             payment.amount,
      method:             payment.method,
      reference:          payment.reference ?? undefined,
      status:             payment.status,
      recordedAt:         payment.recordedAt,
      schoolName,
      studentFullName:    student.fullName,
      studentGrade:       student.grade,
      studentParentPhone: student.parentPhone,
      balanceUSD: payment.status === 'VERIFIED' && values.currency === 'USD'
        ? Math.max(0, student.balanceUSD - values.amount)
        : student.balanceUSD,
      balanceZiG: payment.status === 'VERIFIED' && values.currency === 'ZIG'
        ? Math.max(0, student.balanceZiG - values.amount)
        : student.balanceZiG,
      paidInZig:        payment.paidInZig        ?? undefined,
      zigAmountPaid:    payment.zigAmountPaid    ?? undefined,
      exchangeRateUsed: payment.exchangeRateUsed ?? undefined,
    };

    reset();
    setPaidInZig(false);
    setZigAmountInput(undefined);
    onSuccess(receipt);
  }

  const submitDisabled = isSubmitting || (paidInZig && (!exchangeRate || !zigAmountInput));

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Record Payment — ${student.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button form="payment-form" type="submit" loading={isSubmitting} disabled={submitDisabled}>
            Record Payment
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <input type="hidden" {...register('studentId')} />

        {/* Currency toggle */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#292524]">Currency</span>
          <div className="flex gap-2">
            {(['USD', 'ZIG'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  if (paidInZig) return;
                  setValue('currency', c, { shouldValidate: true });
                }}
                disabled={paidInZig && c === 'ZIG'}
                className={`min-h-[44px] flex-1 rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                  currency === c
                    ? 'border-[#065f46] bg-[#065f46] text-white'
                    : 'border-[#e7e5e4] bg-white text-[#78716c] hover:border-[#065f46]/50 hover:bg-stone-50'
                } ${paidInZig && c === 'ZIG' ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {c === 'USD' ? 'USD' : 'ZiG'}
              </button>
            ))}
          </div>
          {exchangeRate && (
            <p className="rounded bg-[#f5f5f4] px-3 py-1 text-xs text-[#78716c]">
              Current rate: 1 USD = ZiG {exchangeRate.usdToZig.toFixed(2)}
              {exchangeRate.createdAt && ` (updated ${formatDate(new Date(exchangeRate.createdAt))})`}
            </p>
          )}
        </div>

        {/* ZiG conversion toggle — only for USD fees */}
        {currency === 'USD' && (
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={paidInZig}
              onChange={handleZigToggle}
              className="h-4 w-4 rounded border-[#e7e5e4] accent-[#065f46]"
            />
            <span className="text-sm font-medium text-[#292524]">Parent is paying in ZiG</span>
          </label>
        )}

        {/* Amount section */}
        {paidInZig ? (
          <div className="flex flex-col gap-2">
            {!exchangeRate ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                No rate set. Go to Settings → Exchange Rate to set today&apos;s rate.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="zig-amount" className="text-sm font-medium text-[#292524]">
                    ZiG Amount Received <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="zig-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={zigAmountInput ?? ''}
                    onChange={(e) =>
                      handleZigInput(e.target.value ? Number(e.target.value) : undefined)
                    }
                    placeholder="e.g. 8000"
                    className="block min-h-[44px] w-full rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524] placeholder-[#a8a29e] focus:border-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#065f46]/20"
                  />
                  <p className="text-xs text-[#78716c]">Outstanding: {formatUSD(student.balanceUSD)}</p>
                </div>

                {zigAmountInput && zigAmountInput > 0 && (
                  <div className="rounded-md border border-[#15803d] bg-[#f0fdf4] px-3 py-2.5">
                    <p className="mb-1 text-xs font-semibold text-[#15803d]">Conversion</p>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[#292524]">{formatZiG(zigAmountInput)}</span>
                      <span className="text-[#78716c]">÷ {exchangeRate.usdToZig.toFixed(2)}</span>
                      <span className="font-bold text-[#065f46]">
                        = {formatUSD(Math.round((zigAmountInput / exchangeRate.usdToZig) * 100) / 100)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Input
              id="payment-amount"
              label="Amount"
              type="number"
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
              hint={outstandingHint}
              error={errors.amount?.message}
              {...register('amount', { valueAsNumber: true })}
            />
            {currency === 'ZIG' && student.balanceUSD > 0 && amount > 0 && exchangeRate && (
              <p className="text-xs text-[#78716c]">
                {formatZiG(amount)} = approx. {formatUSD(amount / exchangeRate.usdToZig)} at current rate
              </p>
            )}
          </div>
        )}

        {/* Method toggle */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#292524]">Payment Method</span>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setValue('method', m.value, { shouldValidate: true })}
                className={`min-h-[44px] rounded-md border text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 ${
                  method === m.value
                    ? 'border-[#065f46] bg-[#065f46] text-white'
                    : 'border-[#e7e5e4] bg-white text-[#78716c] hover:border-[#065f46]/50 hover:bg-stone-50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fee label */}
        <Input
          id="feeLabel"
          label="Fee Label"
          required
          placeholder="e.g. Term 1 School Fees"
          error={errors.feeLabel?.message}
          {...register('feeLabel')}
        />

        {/* Non-cash extras */}
        {isNonCash && (
          <>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              Non-cash payments require proof of payment verification.
            </div>

            <Input
              id="reference"
              label="Reference"
              required
              placeholder="Transaction reference number"
              error={errors.reference?.message}
              {...register('reference')}
            />

            <FileUpload
              endpoint="proofOfPayment"
              label="Proof of Payment (optional)"
              onUpload={(url) => setValue('popUrl', url)}
            />
          </>
        )}
      </form>
    </Modal>
  );
}
