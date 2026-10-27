'use client';

// The attendant counts the cash for the day. The system says what it should be; a difference needs a note.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';

export function CashUpForm({ expected }: { expected: { currency: 'USD' | 'ZIG'; cents: number }[] }) {
  const router = useRouter();
  const [currency, setCurrency] = useState<'USD' | 'ZIG'>(expected[0]?.currency ?? 'USD');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exp = expected.find((e) => e.currency === currency)?.cents ?? 0;
  async function save() {
    setBusy(true); setError(null);
    const r = await api('/api/facilities/tuckshop/cashup', 'POST', { currency, countedCents: Math.round(Number(counted.replace(',', '.')) * 100), note: note || undefined });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Cash-up saved');
    setCounted(''); setNote('');
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <select aria-label="Currency" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'ZIG')}><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select>
      <p className="text-sm text-muted">Cash sales today: <b className="text-ink">{(exp / 100).toFixed(2)}</b></p>
      <input aria-label="Cash counted" className={fieldClass} inputMode="decimal" placeholder="Cash counted" value={counted} onChange={(e) => setCounted(e.target.value)} />
      <input aria-label="Note if different" className={fieldClass} placeholder="Why it differs (only if it does)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void save()}>Save cash-up</Button>
    </div>
  );
}
