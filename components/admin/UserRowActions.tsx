'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  userId: string;
  active: boolean;
}

export function UserRowActions({ userId, active }: Props) {
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to update user');
        return;
      }
      toast.success(active ? 'User deactivated' : 'User reactivated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to reset password');
        return;
      }
      setTempPassword(data.data.tempPassword);
    } finally {
      setBusy(false);
    }
  }

  function handleCloseTempPassword() {
    setTempPassword(null);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggleActive}
        disabled={busy}
        className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 disabled:opacity-50"
      >
        {active ? 'Deactivate' : 'Reactivate'}
      </button>
      <button
        type="button"
        onClick={resetPassword}
        disabled={busy}
        className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 disabled:opacity-50"
      >
        Reset Password
      </button>

      <Modal
        open={tempPassword != null}
        onClose={handleCloseTempPassword}
        title="Password Reset"
        footer={<Button onClick={handleCloseTempPassword}>Done</Button>}
      >
        {tempPassword && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#78716c]">
              Share this temporary password with the user. It will not be shown again.
            </p>
            <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">New Temporary Password</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-[#065f46]">{tempPassword}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
