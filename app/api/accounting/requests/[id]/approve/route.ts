import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canApproveRequest } from '@/lib/permissions';
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

  try { await canApproveRequest(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await prisma.expenseRequest.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true },
  });
  if (!existing) return apiNotFound('Request');
  if (existing.status !== 'PENDING') return apiError('Only pending requests can be approved', 409);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.expenseRequest.update({
      where: { id: params.id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
      include: REQUEST_INCLUDE,
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'APPROVE_EXPENSE_REQUEST',
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
export const POST = withApi('POST /api/accounting/requests/[id]/approve', _POST as H);
