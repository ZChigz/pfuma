'use client';

// Verify a payment, optionally choosing which charges it settles. Left alone, the money settles the oldest charges first (or the one the payer named).
// Anything not placed stays on the account as credit.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Notice, api, fieldClass, problem } from '@/components/finance/shared';
import { formatMoney, type Cur } from '@/lib/finance/money';

interface Open { chargeId: string; description: string; termName: string; fundId: string; currency: Cur; outstandingCents: number }

export function VerifyWithSplits({ paymentId, studentId, currency, fundId, amountCents }: { paymentId: string; studentId: string; currency: Cur; fundId: string | null; amountCents: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [charges, setCharges] = useState<Open[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  async function show() {
    setOpen(true);
    const r = await api(`/api/finance/accounts/${studentId}`, 'GET');
    if (r.ok) {
      const list = (r.body.data as { charges: Open[] }).charges;
      setCharges(list.filter((c) => c.currency === currency && c.outstandingCents > 0 && (!fundId || c.fundId === fundId)));
    }
  }

  const cents = (s: string) => { const t = (s ?? '').replace(/,/g, '').trim(); if (!/^\d+(\.\d{1,2})?$/.test(t)) return 0; const [w, f = ''] = t.split('.'); return Number(w) * 100 + Number(f.padEnd(2, '0')); };
  const placed = charges.reduce((s, c) => s + cents(amounts[c.chargeId] ?? ''), 0);
  const over = placed > amountCents;

  async function verify(splits?: { chargeId: string; amount: string }[]) {
    setBusy(true);
    const r = await api(`/api/finance/payments/${paymentId}/verify`, 'POST', splits ? { splits } : {});
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Verified');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="primary" loading={busy && !open} onClick={() => void verify()}>Verify</Button>
      <Button size="sm" variant="ghost" onClick={() => void show()}>Choose what it settles</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Verify and choose what it settles" size="md"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={over || placed === 0} onClick={() => void verify(charges.filter((c) => cents(amounts[c.chargeId] ?? '') > 0).map((c) => ({ chargeId: c.chargeId, amount: amounts[c.chargeId]!.replace(/,/g, '').trim() })))}>Verify with these amounts</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">The payment holds <strong>{formatMoney(amountCents, currency)}</strong>. Put an amount against each charge it should settle. What you leave unplaced ({formatMoney(Math.max(0, amountCents - placed), currency)}) stays as credit.</p>
          {charges.length === 0 && <p className="text-sm text-muted">No open charges in this currency{fundId ? ' and fund' : ''}.</p>}
          {charges.map((c) => (
            <div key={c.chargeId} className="grid grid-cols-[1fr_8rem] items-center gap-2">
              <label htmlFor={`sp-${c.chargeId}`} className="text-sm">{c.description} <span className="text-muted">· {c.termName} · owes {formatMoney(c.outstandingCents, c.currency)}</span></label>
              <input id={`sp-${c.chargeId}`} className={fieldClass} inputMode="decimal" placeholder="0.00" value={amounts[c.chargeId] ?? ''} onChange={(e) => setAmounts({ ...amounts, [c.chargeId]: e.target.value })} />
            </div>
          ))}
          {over && <Notice tone="danger">That is more than the payment holds.</Notice>}
        </div>
      </Modal>
    </>
  );
}
