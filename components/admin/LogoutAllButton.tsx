'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

// Ends every other user's sessions at once (e.g. after a lost phone or a suspected leak).
export function LogoutAllButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!confirm('Sign every other user out of all devices? They will need to sign in again.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users/logout-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to sign users out');
        return;
      }
      toast.success(`Signed ${data.data.loggedOut} user(s) out`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" onClick={run} loading={busy}>
      Log out all sessions
    </Button>
  );
}
