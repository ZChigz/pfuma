import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canVoidPayment } from '@/lib/permissions';
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
    await canVoidPayment(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true },
  });
  if (!payment) return apiNotFound('Payment');
  if (payment.status === 'VOIDED') return apiError('Payment is already voided', 409);

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: params.id },
      data: {
        status:   'VOIDED',
        voidedBy: user.id,
        voidedAt: new Date(),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'VOID_PAYMENT',
        entityType: 'Payment',
        entityId:   params.id,
      },
      tx,
    );
    return p;
  });

  return apiSuccess({ payment: { ...updated, amount: updated.amount.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/payments/[id]/void', _POST as H);
