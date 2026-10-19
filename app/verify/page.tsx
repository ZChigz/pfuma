// Public: type the code printed on a report card to check it.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Check a report card · Pfuma', robots: { index: false, follow: false } };

async function go(form: FormData) {
  'use server';
  const code = String(form.get('code') ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length === 8) redirect(`/verify/${code.slice(0, 4)}-${code.slice(4)}`);
  redirect('/verify?bad=1');
}

export default function VerifyIndex({ searchParams }: { searchParams: { bad?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <form action={go} className="w-full max-w-md rounded-2xl bg-white p-8">
        <h1 className="text-lg font-semibold text-ink">Check a report card</h1>
        <p className="mt-1 text-sm text-muted">Type the code printed at the bottom of the card, or scan its QR code.</p>
        <label htmlFor="code" className="mt-6 block text-sm font-semibold text-ink">Verification code</label>
        <input id="code" name="code" required autoComplete="off" autoCapitalize="characters" maxLength={9} placeholder="ABCD-2345"
          className="mt-1 h-12 w-full rounded-xl border border-line px-4 text-lg tracking-widest focus:border-primary focus:outline-none" aria-invalid={searchParams.bad ? true : undefined} />
        {searchParams.bad && <p role="alert" className="mt-2 text-sm text-danger">A code has 8 letters and numbers, like ABCD-2345.</p>}
        <button type="submit" className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">Check</button>
      </form>
    </main>
  );
}
