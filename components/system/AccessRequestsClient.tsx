'use client';
// The queue of requests for access. Approving gives a time-limited exception; declining needs a reason.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { send } from '@/components/access/send';
import { Can } from '@/components/access/AccessProvider';
import type { RequestRow } from '@/lib/system/access-admin';

const VARIANT = { PENDING: 'warning', APPROVED: 'success', DECLINED: 'neutral' } as const;
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function AccessRequestsClient({ rows, isOwner }: { rows: RequestRow[]; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ row: RequestRow; mode: 'APPROVE' | 'DECLINE' } | null>(null);
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide() {
    if (!open) return;
    setBusy(true);
    const body = open.mode === 'APPROVE' ? { decision: 'APPROVE', days: Number(days) } : { decision: 'DECLINE', reason };
    const r = await send(`/api/system/access-requests/${open.row.id}`, 'POST', body);
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(open.mode === 'APPROVE' ? 'Access given for a limited time' : 'Request declined');
    setOpen(null);
    setReason('');
    router.refresh();
  }

  if (!rows.length) return <p className="rounded-2xl bg-white p-6 text-sm text-muted">Nobody has asked for access.</p>;
  return (
    <>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-2xl bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">{r.userName}</span>
              <Badge variant={VARIANT[r.status]} label={r.status === 'PENDING' ? 'Waiting' : r.status === 'APPROVED' ? 'Approved' : 'Declined'} />
            </div>
            <p className="text-sm text-ink">Wants to: <strong>{r.label}</strong> <span className="text-muted">({r.permissionKey})</span></p>
            {r.page && <p className="text-xs text-muted">From the page {r.page} on {when(r.createdAt)}</p>}
            <p className="text-sm text-muted">&ldquo;{r.reason}&rdquo;</p>
            {r.status !== 'PENDING' && <p className="text-xs text-muted">{r.status === 'APPROVED' ? 'Approved' : 'Declined'} by {r.decidedBy}{r.decisionNote ? `: ${r.decisionNote}` : ''}</p>}
            {r.status === 'PENDING' && (
              <Can permission="system.users.edit">
                {r.ownerOnly && !isOwner ? (
                  <p className="text-xs text-muted">This is about money or staff pay, so only the Owner can decide it.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setOpen({ row: r, mode: 'APPROVE' })}>Approve for a time</Button>
                    <Button size="sm" variant="secondary" onClick={() => setOpen({ row: r, mode: 'DECLINE' })}>Decline</Button>
                  </div>
                )}
              </Can>
            )}
          </li>
        ))}
      </ul>
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.mode === 'APPROVE' ? 'Give access for a time' : 'Decline this request'}
        footer={<><Button variant="secondary" onClick={() => setOpen(null)} disabled={busy}>Cancel</Button><Button onClick={decide} loading={busy} disabled={open?.mode === 'DECLINE' && !reason.trim()}>{open?.mode === 'APPROVE' ? 'Give access' : 'Decline'}</Button></>}
      >
        {open?.mode === 'APPROVE' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{open.row.userName} will be able to {open.row.label.charAt(0).toLowerCase() + open.row.label.slice(1)} until the access runs out. It is listed under Exceptions and you can end it at any time.</p>
            <Input label="For how many days? (1 to 90)" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        ) : (
          <Input label="Why not? The person will see this." value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        )}
      </Modal>
    </>
  );
}
