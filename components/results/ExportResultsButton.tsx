'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Props {
  classId:   string;
  className: string;
  term:      string;
}

export function ExportResultsButton({ classId, className, term }: Props) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function handleExport() {
    setLoading(true);
    try {
      const res = await fetch(`/api/results/export?classId=${classId}&term=${encodeURIComponent(term)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.message ?? 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${className}_${term}_Results.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleExport} loading={loading}>
      Export to Excel
    </Button>
  );
}
