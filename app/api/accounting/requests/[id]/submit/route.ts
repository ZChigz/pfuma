import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, apiForbidden, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { REQUEST_INCLUDE, serializeExpenseRequest } from '@/lib/expense-requests';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const existing = await prisma.expenseRequest.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, requestedById: true },
  });
  if (!existing) return apiNotFound('Request');
  if (existing.requestedById !== user.id) return apiForbidden();
  if (existing.status !== 'DRAFT') return apiError('Only draft requests can be submitted', 409);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.expenseRequest.update({
      where: { id: params.id },
      data: { status: 'PENDING', requestedAt: new Date() },
      include: REQUEST_INCLUDE,
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'SUBMIT_EXPENSE_REQUEST',
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
export const POST = withApi('POST /api/accounting/requests/[id]/submit', _POST as H);
