'use client';

// Pay school fees online with Paynow from the parent portal. The guardian chooses the currency and amount; Paynow takes them through the payment
// and the school is told when it goes through. The receipt is made at the school as soon as Paynow confirms.
import { useState } from 'react';

export function PortalPay({ token, owed }: { token: string; owed: { USD: number; ZIG: number } }) {
  const currencies = (['USD', 'ZIG'] as const).filter((c) => owed[c] > 0);
  const [currency, setCurrency] = useState<'USD' | 'ZIG'>(currencies[0] ?? 'USD');
  const [amount, setAmount] = useState(currencies[0] ? (owed[currencies[0]] / 100).toFixed(2) : '');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (currencies.length === 0) return null;

  async function pay() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/portal/paynow/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, currency, amount: amount.replace(/,/g, ''), email: email || undefined }) });
      const body = (await res.json()) as { success: boolean; data?: { redirectUrl: string }; message?: string };
      if (!res.ok || !body.success || !body.data) { setError(body.message ?? 'Could not start the payment'); setBusy(false); return; }
      window.location.href = body.data.redirectUrl;
    } catch {
      setError('Could not reach the payment service. Try again.');
      setBusy(false);
    }
  }

  const valid = /^\d+(\.\d{1,2})?$/.test(amount.replace(/,/g, '').trim()) && Number(amount.replace(/,/g, '')) > 0;
  return (
    <div className="mt-4 rounded-2xl bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Pay online</h3>
      <p className="mt-0.5 text-xs text-muted">Pay with EcoCash, OneMoney, InnBucks or a card through Paynow.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">Currency
          <select className="h-11 rounded-xl border border-line bg-white px-3 text-sm" value={currency} onChange={(e) => { const c = e.target.value as 'USD' | 'ZIG'; setCurrency(c); setAmount((owed[c] / 100).toFixed(2)); }}>
            {currencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">Amount
          <input className="h-11 rounded-xl border border-line bg-white px-3 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink">Email (optional)
          <input className="h-11 rounded-xl border border-line bg-white px-3 text-sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
      <button type="button" disabled={!valid || busy} onClick={() => void pay()} className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-primary px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Please wait…' : 'Pay with Paynow'}</button>
    </div>
  );
}
