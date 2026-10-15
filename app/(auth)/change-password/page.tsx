'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-rules';

const inputClass =
  'min-h-[48px] rounded-xl border border-line bg-canvas px-4 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/30';

// Shown right after sign-in for accounts an admin created or reset, and open to
// any signed-in user. Changing the password ends all sessions, so the user
// signs in again with the new one.
export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < PASSWORD_MIN_LENGTH) {
      setError(`Your new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not change the password.');
        return;
      }
      await signOut({ callbackUrl: '/login' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-ink">Choose a new password</h1>
      <p className="mb-8 text-sm text-muted">
        Use at least {PASSWORD_MIN_LENGTH} characters. You will be asked to sign in again afterwards.
      </p>
      <form onSubmit={submit} noValidate aria-label="Change password form" className="space-y-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current" className="text-sm font-medium text-ink">Current (temporary) password</label>
          <input id="current" type="password" autoComplete="current-password" value={current}
            onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new" className="text-sm font-medium text-ink">New password</label>
          <input id="new" type="password" autoComplete="new-password" value={next}
            onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-medium text-ink">Repeat new password</label>
          <input id="confirm" type="password" autoComplete="new-password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </div>
        {error && (
          <div role="alert" className="rounded-xl bg-danger-bg px-4 py-3">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </>
  );
}
