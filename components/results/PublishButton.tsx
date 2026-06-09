'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  grade: string;
  term:  string;
}

export function PublishButton({ grade, term }: Props) {
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
        body:    JSON.stringify({ grade, term }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message ?? 'Publish failed'); return; }
      toast.success(`Published ${data.data.published} results`);
      setConfirming(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setConfirming(true)}>Publish Results</Button>

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
          Are you sure you want to publish results for{' '}
          <strong>{grade}</strong> — <strong>{term}</strong>?
        </p>
        <p className="mt-2 text-sm text-[#78716c]">
          Once published, marks are locked and visible on student portals.
          This action cannot be undone.
        </p>
      </Modal>
    </>
  );
}
