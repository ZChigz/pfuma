'use client';
// "Request access" on the access-denied page: names the permission and the page, asks why, and sends it to the Administrator (or the Owner).
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { PERMISSIONS } from '@/lib/access-core';
import { requiredKeysFor } from '@/lib/access/routes';
import { send } from './send';

const OPTIONS = Object.entries(PERMISSIONS).map(([value, label]) => ({ value, label: `${label} (${value})` }));

export function RequestAccessButton({ permission }: { permission?: string }) {
  const pathname = usePathname() ?? '';
  const known = permission ?? requiredKeysFor(pathname)?.[0] ?? '';
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(known);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await send('/api/system/access-requests', 'POST', { permissionKey: key, page: pathname, reason });
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    setDone(true);
    toast.success('Your request was sent');
  }

  if (done) return <p className="text-sm text-success">Request sent. You will be told when it is decided.</p>;
  if (!open) return <Button variant="secondary" onClick={() => setOpen(true)}>Request access</Button>;
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3 text-left">
      {known ? (
        <p className="text-sm text-ink">You are asking for: <strong>{PERMISSIONS[known as keyof typeof PERMISSIONS] ?? known}</strong></p>
      ) : (
        <Select id="request-key" label="What do you need to do?" options={OPTIONS} value={key} placeholder="Choose" onChange={(e) => setKey(e.target.value)} required />
      )}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Why do you need it?
        <textarea className="min-h-[88px] rounded-lg border border-border px-3 py-2 text-sm font-normal" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!key || !reason.trim()}>Send request</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
