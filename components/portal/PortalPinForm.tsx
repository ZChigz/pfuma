'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Asked once per device; the server remembers the device with a signed cookie.
export function PortalPinForm({ token }: { token: string }) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/portal/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not check the PIN');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 text-center" aria-label="Portal PIN">
        <h1 className="text-base font-semibold text-ink">Enter your PIN</h1>
        <p className="mt-1 text-sm text-muted">
          The school sent a 4-digit PIN to the parent or guardian&apos;s phone. You only need it once on this device.
        </p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="4-digit PIN"
          className="mt-5 min-h-[48px] w-full rounded-xl border border-line bg-canvas px-4 text-center text-xl tracking-[0.5em] text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          autoFocus
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || pin.length !== 4}
          className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'View portal'}
        </button>
      </form>
    </div>
  );
}
