'use client';

// The boarding master's pocket money desk: pay in, hand back, set a weekly limit, close a wallet when a learner leaves.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

type Mode = 'deposit' | 'withdraw' | 'limits' | 'close';
const toCents = (v: string) => Math.round(Number(v.replace(',', '.')) * 100);

export function WalletDesk() {
  const router = useRouter();
  const [s, setS] = useState<Learner | null>(null);
  const [mode, setMode] = useState<Mode>('deposit');
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [limit, setLimit] = useState('');
  const [action, setAction] = useState('REFUNDED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!s) { setError('Choose the learner'); return; }
    setBusy(true); setError(null);
    const base = { studentId: s.id, currency };
    const [url, body] = mode === 'deposit' ? ['deposit', { ...base, amountCents: toCents(amount), note: note || undefined }]
      : mode === 'withdraw' ? ['withdraw', { ...base, amountCents: toCents(amount), note }]
      : mode === 'limits' ? ['limits', { ...base, weeklyLimitCents: limit ? toCents(limit) : null }]
      : ['close', { ...base, action, note }];
    const r = await api(`/api/facilities/tuckshop/wallets/${url}`, 'POST', body);
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    const d = r.body.data as { balanceCents?: number; receipt?: string | null };
    toast.success(d.balanceCents !== undefined ? `Done. Balance ${(d.balanceCents / 100).toFixed(2)} ${currency}${d.receipt ? ` · receipt ${d.receipt}` : ''}` : 'Done');
    setAmount(''); setNote('');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <LearnerPicker id="wallet-learner" value={s} onChange={setS} boardersOnly />
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="What to do">
        {([['deposit', 'Pay in'], ['withdraw', 'Hand back'], ['limits', 'Limit'], ['close', 'Close']] as const).map(([m, l]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-[44px] rounded-xl text-xs font-semibold ${mode === m ? 'bg-primary text-white' : 'bg-canvas ring-1 ring-line'}`}>{l}</button>
        ))}
      </div>
      <select aria-label="Currency" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select>
      {(mode === 'deposit' || mode === 'withdraw') && <input aria-label="Amount" className={fieldClass} inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      {mode === 'limits' && <input aria-label="Weekly limit" className={fieldClass} inputMode="decimal" placeholder="Weekly spending limit (empty for none)" value={limit} onChange={(e) => setLimit(e.target.value)} />}
      {mode === 'close' && <select aria-label="Balance" className={fieldClass} value={action} onChange={(e) => setAction(e.target.value)}><option value="REFUNDED">Refund the balance</option><option value="CARRIED_FORWARD">Carry the balance forward</option></select>}
      {mode !== 'limits' && <input aria-label="Note" className={fieldClass} placeholder={mode === 'deposit' ? 'Who handed it in (a note)' : 'What it is for'} value={note} onChange={(e) => setNote(e.target.value)} />}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void go()}>Save</Button>
    </div>
  );
}
