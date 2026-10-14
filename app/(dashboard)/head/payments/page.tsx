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
    student: { select: { fullName: true, currentClass: { select: { name: true } } } },
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Payments</h1>
        <p className="mt-1 text-sm text-muted">Verify pending payments and review recent activity</p>
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold text-ink">Pending verification ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No payments awaiting verification.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Student', 'Class', 'Method', 'Reference', 'Amount', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {pending.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.student.fullName}</td>
                    <td className="px-4 py-3 text-muted">{p.student.currentClass?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant={p.method === 'CASH' ? 'success' : 'neutral'} />
                    </td>
                    <td className="px-4 py-3 text-muted">{p.reference ?? '—'}</td>
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
        <h2 className="mb-3 text-base font-semibold text-ink">Recent verified</h2>
        {verified.length === 0 ? (
          <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
            No verified payments yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white">
            <table className="w-full text-left text-sm text-ink">
              <thead className="border-b border-line bg-white">
                <tr>
                  {['Student', 'Class', 'Method', 'Reference', 'Amount', 'Date'].map((h, i) => (
                    <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {verified.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-medium">{p.student.fullName}</td>
                    <td className="px-4 py-3 text-muted">{p.student.currentClass?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge label={p.method} variant="neutral" />
                    </td>
                    <td className="px-4 py-3 text-muted">{p.reference ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {p.currency === 'USD' ? formatUSD(p.amount.toNumber()) : formatZiG(p.amount.toNumber())}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{formatDateTime(p.recordedAt)}</td>
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
