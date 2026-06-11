import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canDisburseRequest } from '@/lib/permissions';
import { EXPENSE_CATEGORY_BY_TYPE, REQUEST_INCLUDE, serializeExpenseRequest } from '@/lib/expense-requests';
import { DisburseExpenseRequestSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canDisburseRequest(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await prisma.expenseRequest.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, type: true, title: true, requestNumber: true, currency: true },
  });
  if (!existing) return apiNotFound('Request');
  if (existing.status !== 'APPROVED') return apiError('Only approved requests can be disbursed', 409);

  const parsed = await parseBody(req, DisburseExpenseRequestSchema);
  if ('error' in parsed) return parsed.error;
  const { actualTotal, paymentMethod, disbursementNote } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.expenseRequest.update({
      where: { id: params.id },
      data: {
        status:           'DISBURSED',
        disbursedById:    user.id,
        disbursedAt:      new Date(),
        actualTotal,
        paymentMethod,
        disbursementNote: disbursementNote || null,
      },
      include: REQUEST_INCLUDE,
    });
    const e = await tx.expense.create({
      data: {
        schoolId:        user.schoolId,
        category:        EXPENSE_CATEGORY_BY_TYPE[existing.type],
        currency:        existing.currency,
        amount:          actualTotal,
        note:            `${existing.title} — ${existing.requestNumber}`,
        spentOn:         new Date(),
        recordedBy:      user.id,
        status:          'ACTIVE',
        expenseRequestId: r.id,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'DISBURSE_EXPENSE_REQUEST',
        entityType: 'ExpenseRequest',
        entityId:   r.id,
        detail:     r.requestNumber,
      },
      tx,
    );
    return { request: r, expense: e };
  });

  return apiSuccess({
    request: serializeExpenseRequest(result.request),
    expense: { ...result.expense, amount: result.expense.amount.toNumber() },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/requests/[id]/disburse', _POST as H);
