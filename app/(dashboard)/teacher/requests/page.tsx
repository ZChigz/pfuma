import Link from 'next/link';
import { sendToFinance } from '@/lib/finance/legacy-redirect';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_BADGE } from '@/lib/expense-requests';
import { NewRequestModal } from '@/components/teacher/NewRequestModal';
import type { SessionUser } from '@/types';

export default async function TeacherRequestsPage() {
  await sendToFinance('/finance/requests');
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (user.role !== 'TEACHER') redirect('/');

  const requests = await db.expenseRequest.findMany({
    where: { schoolId: user.schoolId, requestedById: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Requests</h1>
          <p className="mt-1 text-sm text-muted">Request and track approval of expenses</p>
        </div>
        <NewRequestModal />
      </div>

      {requests.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          You haven&apos;t made any requests yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['Request #', 'Title', 'Type', 'Amount', 'Status', 'Date'].map((h) => (
                  <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {requests.map((r) => {
                const amount = (r.actualTotal ?? r.estimatedTotal).toNumber();
                const status = REQUEST_STATUS_BADGE[r.status];
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-rowhover">
                    <td className="px-4 py-3">
                      <Link href={`/teacher/requests/${r.id}`} className="block font-medium text-primary">
                        {r.requestNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/teacher/requests/${r.id}`} className="block">{r.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{REQUEST_TYPE_LABELS[r.type]}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={status.label} variant={status.variant} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(r.createdAt)}</td>
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
