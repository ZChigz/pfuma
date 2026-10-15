'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  expenseId: string;
}

export function ExpenseVoidButton({ expenseId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast  = useToast();

  async function handleVoid() {
    if (!confirm('Void this expense? This cannot be undone.')) return;
    setLoading(true);
    const post = (reason?: string) =>
      fetch(`/api/accounting/expenses/${expenseId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      });
    let res  = await post();
    let data = await res.json();
    // A sole director may void an expense they recorded, but must say why.
    if (!res.ok && res.status === 403 && /Give a reason/.test(data.message ?? '')) {
      const reason = window.prompt(data.message);
      if (reason) {
        res  = await post(reason);
        data = await res.json();
      }
    }
    setLoading(false);
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to void expense');
      return;
    }
    toast.success('Expense voided');
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" onClick={handleVoid} loading={loading}>
      Void
    </Button>
  );
}
