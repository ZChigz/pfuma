'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  studentIds: string[];
  term: string;
}

export function DownloadAllReportsButton({ studentIds, term }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    for (const id of studentIds) {
      window.open(`/api/results/reports/${id}?term=${encodeURIComponent(term)}`, '_blank');
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
