'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export function SubmitRequestButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleSubmit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/requests/${requestId}/submit`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to submit request');
        return;
      }
      toast.success('Request submitted for approval');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={handleSubmit} loading={busy}>
      Submit for Approval
    </Button>
  );
}
