'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  assignmentId: string;
  teacherName:  string;
  subjectName:  string;
  className:    string;
}

export function UnlockSubjectLink({ assignmentId, teacherName, subjectName, className }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const router = useRouter();
  const toast  = useToast();

  async function handleUnlock() {
    setLoading(true);
    try {
      const res  = await fetch('/api/results/marks/unverify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assignmentId }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message ?? 'Failed to unlock'); return; }
      toast.success(data.data.message ?? 'Marks unlocked');
      setConfirming(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-[#14613f] hover:underline focus:outline-none focus:ring-2 focus:ring-[#14613f]/40"
      >
        Unlock subject
      </button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Unlock subject"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={loading}>Cancel</Button>
            <Button variant="primary" onClick={handleUnlock} loading={loading}>
              Yes, Unlock
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#14301f]">
          This will allow <strong>{teacherName}</strong> to edit <strong>{subjectName}</strong> marks for{' '}
          <strong>{className}</strong>. Continue?
        </p>
      </Modal>
    </>
  );
}
