import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { assertCanReviewExpenseRequest } from '@/lib/permissions';
import { REQUEST_INCLUDE, serializeExpenseRequest } from '@/lib/expense-requests';
import { RejectExpenseRequestSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await assertLegacyWritable(db, user.schoolId);

  await authorize(user, 'finance.requests.approve');

  const existing = await db.expenseRequest.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, requestedById: true },
  });
  if (!existing) return apiNotFound('Request');
  if (existing.status !== 'PENDING') return apiError('Only pending requests can be rejected', 409);
  // Separation of duties: the requester cannot reject their own request.
  assertCanReviewExpenseRequest(user, existing, 'reject');

  const parsed = await parseBody(req, RejectExpenseRequestSchema);
  if ('error' in parsed) return parsed.error;

  const updated = await db.$tx(async (tx) => {
    const r = await tx.expenseRequest.update({
      where: { id: params.id },
      data: {
        status:          'REJECTED',
        rejectedById:    user.id,
        rejectedAt:      new Date(),
        rejectionReason: parsed.data.reason,
      },
      include: REQUEST_INCLUDE,
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'REJECT_EXPENSE_REQUEST',
        entityType: 'ExpenseRequest',
        entityId:   r.id,
        detail:     r.requestNumber,
      },
      tx,
    );
    return r;
  });

  return apiSuccess({ request: serializeExpenseRequest(updated) });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/requests/[id]/reject', _POST as H);
