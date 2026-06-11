import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { REQUEST_INCLUDE, REQUEST_TYPE_LABELS, serializeExpenseRequest } from '@/lib/expense-requests';
import { DisburseModal } from '@/components/bursar/DisburseModal';
import type { SessionUser } from '@/types';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH:    'Cash',
  ECOCASH: 'EcoCash',
  SWIPE:   'Swipe',
  ZIPIT:   'ZIPIT',
};

export default async function BursarDisbursementsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'BURSAR') redirect('/');

  const requests = (await prisma.expenseRequest.findMany({
    where: { schoolId: user.schoolId, status: { in: ['APPROVED', 'DISBURSED'] } },
    include: REQUEST_INCLUDE,
    orderBy: { requestedAt: 'desc' },
  })).map(serializeExpenseRequest);

  const toDisburse = requests.filter((r) => r.status === 'APPROVED');
  const disbursed   = requests.filter((r) => r.status === 'DISBURSED');

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Disbursements</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Pay out approved expense requests</p>
      </div>

      {/* To disburse */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[#292524]">To disburse</h2>
          {toDisburse.length > 0 && <Badge label={String(toDisburse.length)} variant="warning" />}
        </div>
        {toDisburse.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
            Nothing waiting to be disbursed.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Request #', 'Title', 'Department', 'Amount', 'Approved By', 'Date', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {toDisburse.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.requestNumber}</td>
                    <td className="px-4 py-3">
                      {r.title}
                      <span className="block text-xs text-[#78716c]">{REQUEST_TYPE_LABELS[r.type]}</span>
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{r.department}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(r.estimatedTotal) : formatZiG(r.estimatedTotal)}
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{r.approvedBy?.fullName ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">
                      {r.approvedAt ? formatDate(r.approvedAt) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <DisburseModal request={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disbursed */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-[#292524]">Disbursed</h2>
        {disbursed.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
            No disbursements yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
            <table className="w-full text-left text-sm text-[#292524]">
              <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                <tr>
                  {['Request #', 'Title', 'Department', 'Amount Paid', 'Method', 'Date'].map((h) => (
                    <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e7e5e4] bg-white">
                {disbursed.map((r) => {
                  const amount = r.actualTotal ?? r.estimatedTotal;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium">{r.requestNumber}</td>
                      <td className="px-4 py-3">
                        {r.title}
                        <span className="block text-xs text-[#78716c]">{REQUEST_TYPE_LABELS[r.type]}</span>
                      </td>
                      <td className="px-4 py-3 text-[#78716c]">{r.department}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">
                        {r.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                      </td>
                      <td className="px-4 py-3 text-[#78716c]">
                        {r.paymentMethod ? PAYMENT_METHOD_LABELS[r.paymentMethod] : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">
                        {r.disbursedAt ? formatDate(r.disbursedAt) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
