import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canVoidExpense } from '@/lib/permissions';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try {
    await canVoidExpense(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const expense = await prisma.expense.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true },
  });
  if (!expense) return apiNotFound('Expense');
  if (expense.status === 'VOIDED') return apiError('Expense is already voided', 409);

  const updated = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.update({
      where: { id: params.id },
      data: {
        status:   'VOIDED',
        voidedBy: user.id,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'VOID_EXPENSE',
        entityType: 'Expense',
        entityId:   params.id,
      },
      tx,
    );
    return e;
  });

  return apiSuccess({ expense: { ...updated, amount: updated.amount.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/expenses/[id]/void', _POST as H);
