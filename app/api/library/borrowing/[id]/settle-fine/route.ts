import { auth } from '@/lib/auth';
import { libraryMoved, LIBRARY_MOVED_MESSAGE } from '@/lib/library';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiNotFound, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import type { SessionUser } from '@/types';

// Marks the fine on a returned book as paid, so it no longer counts towards the unpaid-fine limit.
async function _POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (await libraryMoved(db, user.schoolId)) return apiError(LIBRARY_MOVED_MESSAGE, 409);

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const b = await db.borrowing.findFirst({ where: { id: params.id, schoolId: user.schoolId } });
  if (!b) return apiNotFound('Borrowing');
  if (!b.returnDate) return apiError('Return the book before settling its fine', 409);
  if (b.fineAmount.toNumber() <= 0) return apiError('There is no fine on this borrowing', 409);
  if (b.fineSettled) return apiError('This fine is already settled', 409);

  await db.$tx(async (tx) => {
    await tx.borrowing.update({ where: { id: b.id }, data: { fineSettled: true } });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'SETTLE_LIBRARY_FINE', entityType: 'Borrowing', entityId: b.id, detail: `$${b.fineAmount.toNumber().toFixed(2)}` },
      tx,
    );
  });
  return apiSuccess({ settled: true });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/library/borrowing/[id]/settle-fine', _POST as H);
