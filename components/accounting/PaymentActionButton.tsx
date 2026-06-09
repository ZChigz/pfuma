'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  paymentId: string;
  action: 'verify' | 'void';
  /** When true and disabledLabel is set, renders a locked chip instead of a button. */
  disabled?: boolean;
  disabledLabel?: string;
}

export function PaymentActionButton({ paymentId, action, disabled, disabledLabel }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast  = useToast();

  // Role-locked indicator — no button at all, just a visual affordance
  if (disabled && disabledLabel) {
    return (
      <span
        className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-[#e7e5e4] bg-stone-50 px-2.5 text-xs font-medium text-[#78716c]"
        title={disabledLabel}
      >
        <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
        {disabledLabel}
      </span>
    );
  }

  async function handleClick() {
    const label = action === 'verify' ? 'Verify' : 'Void';
    if (!confirm(`${label} this payment?`)) return;
    setLoading(true);
    const res  = await fetch(`/api/accounting/payments/${paymentId}/${action}`, { method: 'POST' });
    setLoading(false);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Action failed');
      return;
    }
    toast.success(action === 'verify' ? 'Payment verified' : 'Payment voided');
    router.refresh();
  }

  return (
    <Button
      variant={action === 'verify' ? 'primary' : 'danger'}
      size="sm"
      onClick={handleClick}
      loading={loading}
    >
      {action === 'verify' ? 'Verify' : 'Void'}
    </Button>
  );
}
