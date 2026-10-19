'use client';

import { useRouter } from 'next/navigation';

export function PlatformSignOut() {
  const router = useRouter();
  async function out() {
    await fetch('/api/platform/logout', { method: 'POST' });
    router.replace('/platform/login');
    router.refresh();
  }
  return (
    <button type="button" onClick={out} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-tint">
      Sign out
    </button>
  );
}
