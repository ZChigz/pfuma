// Public: anyone can check a printed payslip by its QR code. No sign-in; no amounts are shown.
import type { Metadata } from 'next';
import { verifyPayslip } from '@/lib/payroll/payslip';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Check a payslip · Pfuma', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function VerifyPayslipPage({ params }: { params: { code: string } }) {
  const r = await verifyPayslip(decodeURIComponent(params.code).trim().toUpperCase());
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center">
        {r.valid ? (
          <>
            <h1 className="text-lg font-semibold text-ink">This payslip is genuine</h1>
            <p className="mt-1 text-sm text-muted">Compare these details with the printed payslip. Amounts are not shown here.</p>
            <dl className="mt-6 divide-y divide-line rounded-xl border border-line text-left text-sm">
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">School</dt><dd className="font-semibold text-ink">{r.school}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Month</dt><dd className="font-semibold text-ink">{r.month}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Employee</dt><dd className="font-semibold text-ink">{r.employee}</dd></div>
              <div className="flex justify-between gap-4 px-4 py-3"><dt className="text-muted">Released</dt><dd className="font-semibold text-ink">{r.releasedOn}</dd></div>
            </dl>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-ink">We cannot find this payslip</h1>
            <p className="mt-1 text-sm text-muted">The code is not valid. Please ask the school office.</p>
          </>
        )}
      </div>
    </main>
  );
}
