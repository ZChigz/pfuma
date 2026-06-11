'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';

interface Props {
  id: string;
}

export function RemoveAssignmentButton({ id }: Props) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function handleRemove() {
    if (!confirm('Remove this assignment? Marks already entered will not be deleted.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/assignments?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to remove assignment');
        return;
      }
      toast.success('Assignment removed');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={busy}
      className="rounded px-2 py-1 text-xs font-medium text-[#b91c1c] hover:underline focus:outline-none focus:ring-2 focus:ring-[#b91c1c]/40 disabled:opacity-50"
    >
      Remove
    </button>
  );
}
