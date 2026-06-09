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
    const res  = await fetch(`/api/accounting/expenses/${expenseId}/void`, { method: 'POST' });
    setLoading(false);
    const data = await res.json();
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
