'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { problem } from '@/components/students/shared';

/** Downloads the students matching the current filters (or just the ticked ones). The server drops the columns the user may not have and records the export. */
export async function downloadStudentExport(params: URLSearchParams, ids?: string[]): Promise<boolean> {
  const filters: Record<string, string> = {};
  params.forEach((v, k) => { if (!['page', 'pageSize', 'sort', 'dir'].includes(k) && v) filters[k] = v; });
  try {
    const res = await fetch('/api/students/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters, ids }) });
    if (!res.ok) {
      toast.error(problem({ ok: false, status: res.status, body: await res.json().catch(() => ({})) }));
      return false;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Exported. The export has been recorded in the audit log.');
    return true;
  } catch {
    toast.error('There is no connection. Check your data and try again.');
    return false;
  }
}

export function ExportListButton() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); await downloadStudentExport(new URLSearchParams(params.toString())); setBusy(false); }}>
      Export
    </Button>
  );
}
