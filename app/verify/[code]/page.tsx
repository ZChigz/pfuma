// Public: anyone can check a report card's verification code. No sign-in. It shows only the student's name, class, term and
// average, which is enough to prove a printed card was not altered, and nothing else.
import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyReportCard } from '@/lib/exams/publish';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Check a report card · Pfuma',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function VerifyPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).trim().toUpperCase();
  const r = await verifyReportCard(code);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        {r.valid ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-bg" aria-hidden="true">
              <svg className="h-7 w-7 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
            </div>
            <h1 className="text-lg font-semibold text-ink">This report card is genuine</h1>
            <p className="mt-1 text-sm text-muted">Compare these details with the printed card. If anything differs, the card has been changed.</p>
            <dl className="mt-6 divide-y divide-line rounded-xl border border-line text-left text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">School</dt><dd className="font-semibold text-ink">{r.school}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Student</dt><dd className="font-semibold text-ink">{r.student}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Class</dt><dd className="font-semibold text-ink">{r.className}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Term</dt><dd className="font-semibold text-ink">{r.term}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Average</dt><dd className="font-semibold text-ink">{r.average === null ? '-' : `${r.average.toFixed(1)}%`}{r.position ? `, position ${r.position}` : ''}</dd></div>
            </dl>
            <p className="mt-4 text-xs text-muted">Code {code}{r.publishedOn ? `, published ${r.publishedOn}` : ''}</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg" aria-hidden="true">
              <svg className="h-7 w-7 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
            </div>
            <h1 className="text-lg font-semibold text-ink">This code is not valid</h1>
            <p className="mt-1 text-sm text-muted">There is no current report card with this code. It may have been withdrawn for a correction, or the code was typed wrongly.</p>
          </>
        )}
        <Link href="/verify" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">Check another code</Link>
      </div>
    </main>
  );
}
