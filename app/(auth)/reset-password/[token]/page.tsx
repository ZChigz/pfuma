'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-rules';

const inputClass =
  'min-h-[48px] rounded-xl border border-line bg-canvas px-4 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/30';

// Opened from a reset link an administrator gave you. The link works once, for 30 minutes.
export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const invite = useSearchParams().get('invite') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Your new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not reset the password.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-ink">{invite ? 'Password set' : 'Password changed'}</h1>
        <p className="text-sm text-muted">You can now sign in with your {invite ? 'password' : 'new password'}. Taking you to the sign-in page…</p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-ink">{invite ? 'Welcome to Pfuma' : 'Reset your password'}</h1>
      <p className="mb-8 text-sm text-muted">{invite ? 'Choose a password to finish setting up your account.' : 'Choose a new password.'} It needs at least {PASSWORD_MIN_LENGTH} characters.</p>
      <form onSubmit={submit} noValidate aria-label="Reset password form" className="space-y-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new" className="text-sm font-medium text-ink">New password</label>
          <input id="new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-medium text-ink">Repeat new password</label>
          <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
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
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </>
  );
}
