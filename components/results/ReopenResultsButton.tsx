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

// Unpublishes a class's results (Head only): hides them from parents and sends every
// subject back to Verified. Needs a reason, which is audited.
export function ReopenResultsButton({ classId, className, termId, termName }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch('/api/results/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, termId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'Could not unpublish the results');
        return;
      }
      toast.success('Results unpublished — parents no longer see this term until it is published again');
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
        Unpublish class results
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Unpublish class results"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="danger" onClick={submit} loading={loading} disabled={reason.trim().length < 10}>
              Unpublish
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Unpublish <strong>{className}</strong> — <strong>{termName}</strong>? Parents stop seeing these results and every subject goes back to Verified.
          Then use &ldquo;Unlock subject&rdquo; on the one subject to fix, let the teacher correct it, verify it, and publish again: positions are recalculated for the whole class.
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
      </Modal>
    </>
  );
}
