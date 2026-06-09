import { Suspense } from 'react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Permission } from '@/lib/permissions';
import { formatUSD, formatZiG, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { PaymentActionButton } from '@/components/accounting/PaymentActionButton';
import type { SessionUser } from '@/types';
import type { Prisma } from '@prisma/client';
import type { ReactNode } from 'react';

type PaymentRow = Prisma.PaymentGetPayload<{
  include: {
    student: { select: { fullName: true; grade: true } };
    voider:  { select: { fullName: true } };
  };
}>;

// ── Shared table ────────────────────────────────────────────────────────────

interface TableProps {
  payments:      PaymentRow[];
  actionCol?:    (p: PaymentRow) => ReactNode;
  showVoidedBy?: boolean;
  emptyMessage?: string;
  dimmed?:       boolean;
}

function PaymentsTable({
  payments,
  actionCol,
  showVoidedBy,
  emptyMessage = 'No payments.',
  dimmed,
}: TableProps) {
  if (payments.length === 0) {
    return (
      <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-8 text-center text-sm text-[#78716c]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-xl border border-[#e7e5e4] ${dimmed ? 'opacity-60' : ''}`}>
      <table className="w-full text-left text-sm text-[#292524]">
        <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
          <tr>
            {[
              'Student', 'Fee Label', 'Method', 'Reference', 'Amount', 'Date',
              ...(showVoidedBy ? ['Voided By'] : []),
              ...(actionCol    ? ['']           : []),
            ].map((h, i) => (
              <th
                key={i}
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e7e5e4] bg-white">
          {payments.map((p) => {
            const amount = p.amount.toNumber();
            return (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{p.student.fullName}</p>
                  <p className="text-xs text-[#78716c]">{p.student.grade}</p>
                </td>
                <td className="px-4 py-3">{p.feeLabel}</td>
                <td className="px-4 py-3">
                  <Badge
                    label={p.method}
                    variant={p.method === 'CASH' ? 'success' : 'neutral'}
                  />
                </td>
                <td className="px-4 py-3 text-[#78716c]">{p.reference ?? '—'}</td>
                <td className="px-4 py-3 tabular-nums font-medium">
                  {p.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-[#78716c]">
                  {formatDateTime(p.recordedAt)}
                </td>
                {showVoidedBy && (
                  <td className="px-4 py-3 text-xs text-[#78716c]">
                    {p.voider?.fullName ?? '—'}
                  </td>
                )}
                {actionCol && (
                  <td className="px-4 py-3">{actionCol(p)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const include = {
  student: { select: { fullName: true, grade: true } },
  voider:  { select: { fullName: true } },
} as const;

export default async function PaymentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;

  const [pending, verified, voided] = await Promise.all([
    prisma.payment.findMany({ where: { schoolId: user.schoolId, status: 'PENDING'  }, include, orderBy: { recordedAt: 'desc' } }),
    prisma.payment.findMany({ where: { schoolId: user.schoolId, status: 'VERIFIED' }, include, orderBy: { recordedAt: 'desc' } }),
    prisma.payment.findMany({ where: { schoolId: user.schoolId, status: 'VOIDED'   }, include, orderBy: { recordedAt: 'desc' } }),
  ]);

  const canVerify = Permission.verifyPayment.includes(user.role);
  const canVoid   = Permission.voidPayment.includes(user.role);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Payments</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Verify and manage student fee payments</p>
      </div>

      {/* ── Pending ── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-[#292524]">
          Pending Verification
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {pending.length}
            </span>
          )}
        </h2>
        <PaymentsTable
          payments={pending}
          emptyMessage="No payments awaiting verification."
          actionCol={(p) => (
            <Suspense>
              <PaymentActionButton
                paymentId={p.id}
                action="verify"
                disabled={!canVerify}
                disabledLabel="Insufficient permissions"
              />
            </Suspense>
          )}
        />
      </section>

      {/* ── Verified ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-[#292524]">Verified Payments</h2>
        <PaymentsTable
          payments={verified}
          emptyMessage="No verified payments yet."
          actionCol={
            canVoid
              ? (p) => (
                  <Suspense>
                    <PaymentActionButton paymentId={p.id} action="void" />
                  </Suspense>
                )
              : undefined
          }
        />
      </section>

      {/* ── Voided (collapsible) ── */}
      <details>
        <summary className="mb-3 flex cursor-pointer list-none items-center gap-2 select-none text-base font-semibold text-[#78716c] hover:text-[#292524]">
          <svg
            className="h-4 w-4 transition-transform [[open]_&]:rotate-90"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
              clipRule="evenodd"
            />
          </svg>
          Voided Payments ({voided.length})
        </summary>
        <PaymentsTable
          payments={voided}
          emptyMessage="No voided payments."
          showVoidedBy
          dimmed
        />
      </details>
    </div>
  );
}
