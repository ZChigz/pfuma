import Link from 'next/link';
import { sendToFinance } from '@/lib/finance/legacy-redirect';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
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
  await sendToFinance('/finance/requests');
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'HEAD') redirect('/');

  const requests = (await db.expenseRequest.findMany({
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
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Expense Requests</h1>
        <p className="mt-1 text-sm text-muted">Review and approve staff expense requests</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/head/requests?tab=${t.key}`}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-ink',
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
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No requests in this category.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Request #', 'Title', 'Department', 'Requested By', 'Amount', 'Date', tab === 'pending' ? '' : 'Status'].map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {activeRows.map((r) => {
                const status = REQUEST_STATUS_BADGE[r.status];
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium">{r.requestNumber}</td>
                    <td className="px-4 py-3">
                      {r.title}
                      <span className="block text-xs text-muted">{REQUEST_TYPE_LABELS[r.type]}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.department}</td>
                    <td className="px-4 py-3 text-muted">{r.requestedBy.fullName}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(r.estimatedTotal) : formatZiG(r.estimatedTotal)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.requestedAt)}</td>
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
