import { redirect } from 'next/navigation';
import { getPlatformAdmin } from '@/lib/platform/session';
import { PlatformLoginForm } from '@/components/platform/PlatformLoginForm';

export const metadata = { title: 'Pfuma Platform · Sign in' };

export default async function PlatformLoginPage() {
  if (await getPlatformAdmin()) redirect('/platform');
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Pfuma Platform</h1>
      <p className="mb-6 mt-1 text-sm text-muted">For Pfuma staff only.</p>
      <PlatformLoginForm />
    </main>
  );
}
