'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';

export function SupportPanel({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/schools/${schoolId}/support`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      const body = await res.json();
      if (!res.ok) { setError(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not open'); return; }
      toast.success(`Looking at ${schoolName}, read-only`);
      // A full load, so the page is drawn with the new session.
      window.location.assign(body.data.redirect);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Support access" subtitle="Look at this school the way its administrator sees it. Read-only, for 30 minutes.">
      <form onSubmit={open} noValidate aria-label="Support access" className="flex flex-col gap-3">
        <Input id="support-reason" label="Why do you need to look in?" required placeholder="For example: the bursar reported a wrong balance" value={reason} onChange={(e) => setReason(e.target.value)} error={error} hint="The reason is written to the school's audit log and to the platform audit." />
        <div><Button type="submit" loading={busy}>View as administrator</Button></div>
      </form>
    </Card>
  );
}
