import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { assertCanVoid, canVoidExpense } from '@/lib/permissions';
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

  try {
    await canVoidExpense(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  const expense = await db.expense.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, status: true, recordedBy: true },
  });
  if (!expense) return apiNotFound('Expense');
  if (expense.status === 'VOIDED') return apiError('Expense is already voided', 409);

  // Separation of duties: not the person who recorded it, unless this school has
  // only one director — then a written reason is required and audited.
  const activeDirectors = await db.user.count({ where: { role: 'DIRECTOR', active: true } });
  const usedException = assertCanVoid(user, expense, 'expense', { activeDirectors, reason });

  const updated = await db.$tx(async (tx) => {
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
          entityType: 'Expense',
          entityId:   params.id,
          detail:     `Sole director voided an expense they recorded. Reason: ${reason}`,
        },
        tx,
      );
    }
    return e;
  });

  return apiSuccess({ expense: { ...updated, amount: updated.amount.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/expenses/[id]/void', _POST as H);
