import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { cn, formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { REQUEST_INCLUDE, REQUEST_TYPE_LABELS, REQUEST_STATUS_BADGE, serializeExpenseRequest } from '@/lib/expense-requests';
import { RequestReviewModal } from '@/components/accounting/RequestReviewModal';
import type { SessionUser } from '@/types';

type Tab = 'pending' | 'approved' | 'rejected';

export default async function HeadRequestsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'HEAD') redirect('/');

  const requests = (await prisma.expenseRequest.findMany({
    where: { schoolId: user.schoolId, status: { in: ['PENDING', 'APPROVED', 'REJECTED', 'DISBURSED'] } },
    include: REQUEST_INCLUDE,
    orderBy: { requestedAt: 'desc' },
  })).map(serializeExpenseRequest);

  const pending  = requests.filter((r) => r.status === 'PENDING');
  const approved = requests.filter((r) => r.status === 'APPROVED' || r.status === 'DISBURSED');
  const rejected = requests.filter((r) => r.status === 'REJECTED');

  const tab: Tab = searchParams.tab === 'approved' || searchParams.tab === 'rejected' ? searchParams.tab : 'pending';

  const tabs: { key: Tab; label: string; count: number; rows: typeof requests }[] = [
    { key: 'pending',  label: `Pending approval (${pending.length})`, count: pending.length,  rows: pending },
    { key: 'approved', label: 'Approved',                              count: approved.length, rows: approved },
    { key: 'rejected', label: 'Rejected',                              count: rejected.length, rows: rejected },
  ];

  const activeRows = tabs.find((t) => t.key === tab)!.rows;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#292524]">Expense Requests</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Review and approve staff expense requests</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-[#e7e5e4]">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/head/requests?tab=${t.key}`}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-[#065f46] text-[#065f46]'
                : 'border-transparent text-[#78716c] hover:text-[#292524]',
            )}
          >
            {t.key === 'pending' ? 'Pending approval' : t.label}
            {t.key === 'pending' && t.count > 0 && (
              <Badge label={String(t.count)} variant="warning" />
            )}
          </Link>
        ))}
      </div>

      {activeRows.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          No requests in this category.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['Request #', 'Title', 'Department', 'Requested By', 'Amount', 'Date', tab === 'pending' ? '' : 'Status'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {activeRows.map((r) => {
                const status = REQUEST_STATUS_BADGE[r.status];
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.requestNumber}</td>
                    <td className="px-4 py-3">
                      {r.title}
                      <span className="block text-xs text-[#78716c]">{REQUEST_TYPE_LABELS[r.type]}</span>
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{r.department}</td>
                    <td className="px-4 py-3 text-[#78716c]">{r.requestedBy.fullName}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(r.estimatedTotal) : formatZiG(r.estimatedTotal)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">{formatDate(r.requestedAt)}</td>
                    <td className="px-4 py-3">
                      {tab === 'pending' ? (
                        <RequestReviewModal request={r} />
                      ) : (
                        <Badge label={status.label} variant={status.variant} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
