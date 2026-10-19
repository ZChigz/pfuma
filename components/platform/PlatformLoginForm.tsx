'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function PlatformLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/platform/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.message ?? 'Could not sign in');
      router.replace('/platform');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Platform sign in" className="flex flex-col gap-4 rounded-2xl bg-white p-5">
      <Input id="pl-email" type="email" label="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input id="pl-password" type="password" label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
      <Button type="submit" loading={busy}>Sign in</Button>
    </form>
  );
}
