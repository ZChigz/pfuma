import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { formatUSD, formatZiG, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_BADGE } from '@/lib/expense-requests';
import { NewRequestModal } from '@/components/teacher/NewRequestModal';
import type { SessionUser } from '@/types';

export default async function TeacherRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'TEACHER') redirect('/');

  const requests = await prisma.expenseRequest.findMany({
    where: { schoolId: user.schoolId, requestedById: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Requests</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Request and track approval of expenses</p>
        </div>
        <NewRequestModal />
      </div>

      {requests.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-12 text-center text-sm text-[#78716c]">
          You haven&apos;t made any requests yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['Request #', 'Title', 'Type', 'Amount', 'Status', 'Date'].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {requests.map((r) => {
                const amount = (r.actualTotal ?? r.estimatedTotal).toNumber();
                const status = REQUEST_STATUS_BADGE[r.status];
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/teacher/requests/${r.id}`} className="block font-medium text-[#065f46]">
                        {r.requestNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/teacher/requests/${r.id}`} className="block">{r.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-[#78716c]">{REQUEST_TYPE_LABELS[r.type]}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">
                      {r.currency === 'USD' ? formatUSD(amount) : formatZiG(amount)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={status.label} variant={status.variant} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#78716c]">{formatDate(r.createdAt)}</td>
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
