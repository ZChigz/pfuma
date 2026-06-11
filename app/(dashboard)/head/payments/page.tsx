import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { PaymentActionButton } from '@/components/accounting/PaymentActionButton';
import type { SessionUser } from '@/types';

export default async function HeadPaymentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const include = {
    student: { select: { fullName: true, grade: true, class: { select: { name: true } } } },
  } as const;

  const [pending, verified] = await Promise.all([
    prisma.payment.findMany({
      where: { schoolId: user.schoolId, status: 'PENDING' },
      include,
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.payment.findMany({
      where: { schoolId: user.schoolId, status: 'VERIFIED' },
      include,
      orderBy: { recordedAt: 'desc' },
      take: 25,
    }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Payments</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Verify pending payments and review recent activity</p>
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[#292524]">Pending verification ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-8 text-center text-sm text-[#78716c]">
            No payments awaiting verification.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Student', 'Class', 'Method', 'Reference', 'Amount', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.student.fullName}</td>
                    <td className="px-4 py-3 text-[#78716c]">{p.student.class?.name ?? p.student.grade}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant={p.method === 'CASH' ? 'success' : 'neutral'} />
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="px-4 py-3">
                      <PaymentActionButton paymentId={p.id} action="verify" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-[#292524]">Recent verified</h2>
        {verified.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-8 text-center text-sm text-[#78716c]">
            No verified payments yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Student', 'Class', 'Method', 'Reference', 'Amount', 'Date'].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {verified.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.student.fullName}</td>
                    <td className="px-4 py-3 text-[#78716c]">{p.student.class?.name ?? p.student.grade}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant="neutral" />
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#78716c]">{formatDateTime(p.recordedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
