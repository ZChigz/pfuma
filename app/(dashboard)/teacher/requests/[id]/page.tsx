import Link from 'next/link';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { formatUSD, formatZiG, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_BADGE } from '@/lib/expense-requests';
import { SubmitRequestButton } from '@/components/teacher/SubmitRequestButton';
import type { SessionUser } from '@/types';

export default async function TeacherRequestDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  if (user.role !== 'TEACHER') redirect('/');

  const request = await prisma.expenseRequest.findUnique({
    where: { id: params.id, schoolId: user.schoolId, requestedById: user.id },
    include: {
      requestedBy: { select: { fullName: true } },
      approvedBy:  { select: { fullName: true } },
      rejectedBy:  { select: { fullName: true } },
      disbursedBy: { select: { fullName: true } },
      items: true,
    },
  });
  if (!request) notFound();

  const formatAmount = request.currency === 'USD' ? formatUSD : formatZiG;
  const status = REQUEST_STATUS_BADGE[request.status];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/teacher/requests" className="text-sm font-medium text-primary">
          &larr; Back to requests
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">{request.requestNumber}</p>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{request.title}</h1>
          <p className="mt-1 text-sm text-muted">{request.department} · {REQUEST_TYPE_LABELS[request.type]}</p>
        </div>
        <Badge label={status.label} variant={status.variant} />
      </div>

      <div className="rounded-2xl bg-white p-5">
        <p className="text-xs font-medium text-muted">Justification</p>
        <p className="mt-1 text-sm text-ink">{request.justification}</p>
      </div>

      {/* Line items */}
      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-white">
            <tr>
              {['Description', 'Qty', 'Unit Price', 'Total'].map((h) => (
                <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {request.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">{item.description}</td>
                <td className="px-4 py-3 tabular-nums">{item.quantity}</td>
                <td className="px-4 py-3 tabular-nums">{formatAmount(item.unitPrice.toNumber())}</td>
                <td className="px-4 py-3 tabular-nums font-medium">{formatAmount(item.total.toNumber())}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-canvas">
              <td colSpan={3} className="px-4 py-3 text-right text-sm font-semibold text-ink">
                {request.status === 'DISBURSED' && request.actualTotal ? 'Actual total' : 'Estimated total'}
              </td>
              <td className="px-4 py-3 text-sm font-bold tabular-nums text-ink">
                {formatAmount(
                  request.status === 'DISBURSED' && request.actualTotal
                    ? request.actualTotal.toNumber()
                    : request.estimatedTotal.toNumber(),
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Timeline */}
      <div className="rounded-2xl bg-white p-5">
        <p className="mb-3 text-xs font-medium text-muted">Timeline</p>
        <ul className="flex flex-col gap-2 text-sm text-ink">
          <li>Created by {request.requestedBy.fullName} on {formatDateTime(request.createdAt)}</li>
          {request.status !== 'DRAFT' && (
            <li>Submitted on {formatDateTime(request.requestedAt)}</li>
          )}
          {request.approvedAt && request.approvedBy && (
            <li>Approved by {request.approvedBy.fullName} on {formatDateTime(request.approvedAt)}</li>
          )}
          {request.rejectedAt && request.rejectedBy && (
            <li>
              Rejected by {request.rejectedBy.fullName} on {formatDateTime(request.rejectedAt)}
              {request.rejectionReason && (
                <span className="block text-muted">Reason: {request.rejectionReason}</span>
              )}
            </li>
          )}
          {request.disbursedAt && request.disbursedBy && (
            <li>Disbursed by {request.disbursedBy.fullName} on {formatDateTime(request.disbursedAt)}</li>
          )}
        </ul>
      </div>

      {request.status === 'DRAFT' && (
        <div className="flex justify-end">
          <SubmitRequestButton requestId={request.id} />
        </div>
      )}
    </div>
  );
}
