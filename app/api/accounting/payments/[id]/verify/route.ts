import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { assertCanVerifyPayment, canVerifyPayment } from '@/lib/permissions';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try {
    await canVerifyPayment(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const payment = await db.payment.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, recordedBy: true },
  });
  if (!payment) return apiNotFound('Payment');
  if (payment.status !== 'PENDING') return apiError('Payment is not pending', 409);
  // Separation of duties: the person who recorded it cannot verify it.
  assertCanVerifyPayment(user, payment);

  const updated = await db.$tx(async (tx) => {
    const p = await tx.payment.update({
      where: { id: params.id },
      data: {
        status:     'VERIFIED',
        verifiedBy: user.id,
        verifiedAt: new Date(),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'VERIFY_PAYMENT',
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
export const POST = withApi('POST /api/accounting/payments/[id]/verify', _POST as H);
