'use client';

// The tuck shop till on a phone: big item buttons, a running total, pay in cash or from the learner's wallet (scan the ID card).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

export interface TuckItem { itemId: string; name: string; size: string | null; qty: number; priceCents: number | null; priceCurrency: 'USD' | 'ZIG' | null }
const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export function TuckPos({ items }: { items: TuckItem[] }) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<'CASH' | 'WALLET'>('CASH');
  const [student, setStudent] = useState<Learner | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const sellable = items.filter((i) => i.priceCents != null && i.priceCurrency);
  const lines = useMemo(() => sellable.filter((i) => cart[i.itemId]), [sellable, cart]);
  const currencies = Array.from(new Set(lines.map((l) => l.priceCurrency!)));
  const total = lines.reduce((s, l) => s + l.priceCents! * cart[l.itemId]!, 0);
  const add = (id: string, d: number) => setCart((c) => { const n = Math.max(0, (c[id] ?? 0) + d); const { [id]: _drop, ...rest } = c; void _drop; return n ? { ...rest, [id]: n } : rest; });

  async function charge() {
    setBusy(true); setError(null);
    const r = await api('/api/facilities/tuckshop/sales', 'POST', {
      lines: lines.map((l) => ({ itemId: l.itemId, qty: cart[l.itemId] })), payment, studentId: student?.id, clientId: crypto.randomUUID(),
    });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    const d = r.body.data as { totalCents: number; currency: string; balanceCents: number | null; lowBalance: boolean };
    setLast(`Sold ${money(d.totalCents, d.currency)}${d.balanceCents !== null ? `. Balance ${money(d.balanceCents, d.currency)}${d.lowBalance ? ' (low)' : ''}` : ''}`);
    toast.success('Sale recorded');
    setCart({}); setStudent(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 pb-28">
      {last && <Notice tone="success">{last}</Notice>}
      <ul className="grid grid-cols-2 gap-2">
        {sellable.map((i) => (
          <li key={i.itemId} className="flex flex-col justify-between rounded-xl border border-line bg-white p-3">
            <p className="text-sm font-semibold text-ink">{i.name}{i.size ? ` (${i.size})` : ''}</p>
            <p className="text-xs text-muted">{money(i.priceCents!, i.priceCurrency!)} · {i.qty} left</p>
            <div className="mt-2 flex items-center justify-between">
              <button type="button" aria-label={`Remove one ${i.name}`} className="min-h-[48px] min-w-[48px] rounded-xl bg-canvas text-xl" onClick={() => add(i.itemId, -1)}>−</button>
              <span className="text-lg font-bold">{cart[i.itemId] ?? 0}</span>
              <button type="button" aria-label={`Add one ${i.name}`} className="min-h-[48px] min-w-[48px] rounded-xl bg-primary text-xl text-white disabled:opacity-40" disabled={(cart[i.itemId] ?? 0) >= i.qty} onClick={() => add(i.itemId, 1)}>+</button>
            </div>
          </li>
        ))}
      </ul>
      {sellable.length === 0 && <p className="text-sm text-muted">The Tuck shop store has no priced stock. Receive stock in Inventory and give each item a selling price.</p>}
      <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-2 border-t border-line bg-white p-3">
        {currencies.length > 1 && <Notice tone="danger">US dollar and ZiG items cannot be sold together.</Notice>}
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Payment">
          {(['CASH', 'WALLET'] as const).map((p) => <button key={p} type="button" aria-pressed={payment === p} onClick={() => setPayment(p)} className={`min-h-[48px] rounded-xl text-sm font-semibold ${payment === p ? 'bg-primary text-white' : 'bg-canvas ring-1 ring-line'}`}>{p === 'CASH' ? 'Cash' : 'Pocket money'}</button>)}
        </div>
        {payment === 'WALLET' && <LearnerPicker id="tuck-learner" value={student} onChange={setStudent} boardersOnly />}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button className="min-h-[56px] text-base" loading={busy} disabled={lines.length === 0 || currencies.length !== 1 || (payment === 'WALLET' && !student)} onClick={() => void charge()}>
          Charge {currencies[0] ? money(total, currencies[0]) : ''}
        </Button>
      </div>
    </div>
  );
}
