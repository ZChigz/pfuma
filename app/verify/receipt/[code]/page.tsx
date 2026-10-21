// Public: anyone can check a printed receipt by its QR code. No sign-in; no learner's name is shown.
import type { Metadata } from 'next';
import { verifyReceipt } from '@/lib/finance/verify';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Check a receipt · Pfuma', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function VerifyReceiptPage({ params }: { params: { code: string } }) {
  const r = await verifyReceipt(decodeURIComponent(params.code).trim().toUpperCase());
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        {r.valid ? (
          <>
            <h1 className="text-lg font-semibold text-ink">{r.voided ? 'This receipt was cancelled' : 'This receipt is genuine'}</h1>
            <p className="mt-1 text-sm text-muted">Compare these details with the printed receipt.</p>
            <dl className="mt-6 divide-y divide-line rounded-xl border border-line text-left text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">School</dt><dd className="font-semibold text-ink">{r.school}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Receipt</dt><dd className="font-semibold text-ink">{r.receiptNumber}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Amount</dt><dd className="font-semibold text-ink">{r.amount}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Date</dt><dd className="font-semibold text-ink">{r.date}</dd></div>
            </dl>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-ink">We cannot find this receipt</h1>
            <p className="mt-1 text-sm text-muted">The code is not valid, or the payment has not been verified yet. Please ask the school office.</p>
          </>
        )}
      </div>
    </main>
  );
}
