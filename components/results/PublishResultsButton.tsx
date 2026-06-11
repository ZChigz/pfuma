'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  classId:    string;
  className:  string;
  term:       string;
  disabled:   boolean;
}

export function PublishResultsButton({ classId, className, term, disabled }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const router = useRouter();
  const toast  = useToast();

  async function handlePublish() {
    setLoading(true);
    try {
      const res  = await fetch('/api/results/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ classId, term }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message ?? 'Publish failed'); return; }
      toast.success(`Published ${data.data.published} results — top student: ${data.data.topStudent ?? '—'}, class average ${data.data.classAverage.toFixed(1)}%`);
      setConfirming(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="w-full"
      >
        Publish results for {className} — {term}
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Publish Results"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={loading}>Cancel</Button>
            <Button variant="primary" onClick={handlePublish} loading={loading}>
              Yes, Publish
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#292524]">
          Are you sure you want to publish results for <strong>{className}</strong> — <strong>{term}</strong>?
        </p>
        <p className="mt-2 text-sm text-[#78716c]">
          This will calculate totals and class positions, lock all marks, and make results visible on student portals.
          This action cannot be undone.
        </p>
      </Modal>
    </>
  );
}
