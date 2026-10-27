'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { send } from '@/components/access/send';

/** "Copy to custom role": the copy starts with the same permissions; the Administrator can then take some out, the Owner can add. */
export function CopyRoleButton({ fromKey, fromName }: { fromKey: string; fromName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${fromName} (copy)`);
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);

  async function copy() {
    setBusy(true);
    const r = await send<{ key: string }>('/api/system/roles', 'POST', { fromKey, name, description: about || undefined });
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success('Custom role created');
    setOpen(false);
    router.push(`/system/roles/${r.data!.key}`);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Copy to custom role</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Copy to custom role"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button onClick={copy} loading={busy} disabled={name.trim().length < 2}>Create copy</Button></>}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">The copy starts with everything {fromName} may do. You can then take permissions out of it.</p>
          <Input label="Name of the new role" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <Input label="What it is for (optional)" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} />
        </div>
      </Modal>
    </>
  );
}
