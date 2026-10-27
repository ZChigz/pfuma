import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { peopleWith } from '@/lib/academics/common';
import { assertCanVoid } from '@/lib/permissions';
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

  await authorize(user, 'finance.payments.void');

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  const payment = await db.payment.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, recordedBy: true },
  });
  if (!payment) return apiNotFound('Payment');
  if (payment.status === 'VOIDED') return apiError('Payment is already voided', 409);

  // Rule 2: not the person who recorded it, unless this school has switched on single-person finance and nobody else can void —
  // then a written reason is required and audited.
  const school = await db.school.findUnique({ where: { id: user.schoolId }, select: { singlePersonFinance: true } });
  const voiders = (await peopleWith(db, user.schoolId, 'finance.payments.void')).length;
  const usedException = assertCanVoid(user, payment, 'payment', { singlePersonFinance: school?.singlePersonFinance ?? false, voiders, reason });

  const updated = await db.$tx(async (tx) => {
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
        detail:     reason || undefined,
      },
      tx,
    );
    if (usedException) {
      await logAudit(
        {
          schoolId:   user.schoolId,
          actorId:    user.id,
          action:     'VOID_WITHOUT_SECOND_APPROVER',
          entityType: 'Payment',
          entityId:   params.id,
          detail:     `Sole director voided a payment they recorded. Reason: ${reason}`,
        },
        tx,
      );
    }
    return p;
  });

  return apiSuccess({ payment: { ...updated, amount: updated.amount.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/payments/[id]/void', _POST as H);
