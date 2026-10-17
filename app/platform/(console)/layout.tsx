import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getPlatformAdmin } from '@/lib/platform/session';
import { PlatformSignOut } from '@/components/platform/PlatformSignOut';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await getPlatformAdmin();
  if (!admin) redirect('/platform/login');
  const link = 'inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-muted hover:bg-tint hover:text-ink';
  return (
    <>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <Link href="/platform" className="text-base font-bold tracking-tight text-ink">Pfuma Platform</Link>
          <nav aria-label="Console" className="flex flex-wrap items-center gap-1">
            <Link href="/platform" className={link}>Schools</Link>
            <Link href="/platform/audit" className={link}>Platform audit</Link>
            <span className="hidden px-2 text-xs text-subtle sm:inline">{admin.fullName}</span>
            <PlatformSignOut />
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5">{children}</main>
    </>
  );
}
