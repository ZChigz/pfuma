'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  studentIds: string[];
  termId: string;
}

export function DownloadAllReportsButton({ studentIds, termId }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    for (const id of studentIds) {
      window.open(`/api/results/reports/${id}?termId=${termId}`, '_blank');
      await new Promise((r) => setTimeout(r, 400));
    }
    setBusy(false);
  }

  return (
    <Button variant="secondary" onClick={handleClick} loading={busy} disabled={studentIds.length === 0}>
      Download all report cards
    </Button>
  );
}
