'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { REQUEST_TYPE_LABELS } from '@/lib/expense-requests';
import type { Currency, ExpenseRequestType } from '@/types';

interface RequestItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ReviewableRequest {
  id: string;
  requestNumber: string;
  title: string;
  type: ExpenseRequestType;
  department: string;
  justification: string;
  currency: Currency;
  estimatedTotal: number;
  requestedAt: string | Date;
  requestedBy: { fullName: string };
  items: RequestItem[];
}

export function RequestReviewModal({ request }: { request: ReviewableRequest }) {
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const formatAmount = request.currency === 'USD' ? formatUSD : formatZiG;

  function handleClose() {
    if (busy) return;
    setOpen(false);
    setRejecting(false);
    setReason('');
  }

  async function handleApprove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/requests/${request.id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to approve request');
        return;
      }
      toast.success('Request approved. Bursar will be notified.');
      handleClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/requests/${request.id}/reject`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to reject request');
        return;
      }
      toast.success('Request rejected.');
      handleClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>View &amp; Decide</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title={`${request.requestNumber} — ${request.title}`}
        size="lg"
        footer={
          rejecting ? (
            <>
              <Button variant="secondary" onClick={() => setRejecting(false)} disabled={busy}>Back</Button>
              <Button variant="danger" onClick={handleReject} loading={busy} disabled={reason.trim().length < 10}>
                Confirm rejection
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose} disabled={busy}>Close</Button>
              <Button variant="danger" onClick={() => setRejecting(true)} disabled={busy}>Reject</Button>
              <Button onClick={handleApprove} loading={busy}>Approve</Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold   text-[#6b7a70]">Type</p>
              <p className="mt-0.5 text-[#14301f]">{REQUEST_TYPE_LABELS[request.type]}</p>
            </div>
            <div>
              <p className="text-xs font-semibold   text-[#6b7a70]">Department</p>
              <p className="mt-0.5 text-[#14301f]">{request.department}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold   text-[#6b7a70]">Justification</p>
            <p className="mt-0.5 text-sm text-[#14301f]">{request.justification}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#e3e9e4]">
            <table className="w-full text-left text-sm text-[#14301f]">
              <thead className="border-b border-[#e3e9e4] bg-[#f4f6f4]">
                <tr>
                  {['Description', 'Qty', 'Unit Price', 'Total'].map((h) => (
                    <th key={h} className="px-4 py-2 text-xs font-semibold   text-[#6b7a70]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e9e4] bg-white">
                {request.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2">{item.description}</td>
                    <td className="px-4 py-2 tabular-nums">{item.quantity}</td>
                    <td className="px-4 py-2 tabular-nums">{formatAmount(item.unitPrice)}</td>
                    <td className="px-4 py-2 tabular-nums font-medium">{formatAmount(item.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#e3e9e4] bg-[#f4f6f4]">
                  <td colSpan={3} className="px-4 py-2 text-right text-sm font-semibold text-[#14301f]">Estimated total</td>
                  <td className="px-4 py-2 text-sm font-bold tabular-nums text-[#14301f]">{formatAmount(request.estimatedTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-[#6b7a70]">
            Requested by {request.requestedBy.fullName} on {formatDate(request.requestedAt)}
          </p>

          {rejecting && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rejection-reason" className="text-sm font-medium text-[#14301f]">
                Reason for rejection<span className="ml-0.5 text-[#b91c1c]" aria-hidden="true">*</span>
              </label>
              <textarea
                id="rejection-reason"
                rows={3}
                placeholder="Explain why this request is being rejected (min. 10 characters)"
                className="rounded-xl border border-[#e3e9e4] bg-white px-3 py-2 text-sm text-[#14301f] placeholder:text-[#6b7a70] focus:outline-none focus:ring-2 focus:ring-[#14613f]/30"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
