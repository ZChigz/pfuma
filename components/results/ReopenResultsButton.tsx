'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  classId:   string;
  className: string;
  termId:    string;
  termName:  string;
}

// Corrects published results: hides them from parents and (optionally) unlocks
// the marks so teachers can fix them. Needs a reason, which is audited.
export function ReopenResultsButton({ classId, className, termId, termName }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [unlockMarks, setUnlockMarks] = useState(true);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch('/api/results/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, termId, reason, unlockMarks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'Could not reopen the results');
        return;
      }
      toast.success('Results reopened — parents no longer see this term until it is published again');
      setOpen(false);
      setReason('');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reopen results
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reopen published results"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="danger" onClick={submit} loading={loading} disabled={reason.trim().length < 10}>
              Reopen
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Reopen <strong>{className}</strong> — <strong>{termName}</strong>? Parents stop seeing these results until you publish again,
          and class positions are recalculated at that point.
        </p>
        <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium text-ink">
          Reason (recorded in the audit log)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="rounded-xl border border-line bg-canvas px-3 py-2 text-sm font-normal text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="e.g. Maths marks for 3 students were entered under the wrong names"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={unlockMarks} onChange={(e) => setUnlockMarks(e.target.checked)} />
          Also unlock the marks so teachers can correct them
        </label>
      </Modal>
    </>
  );
}
