import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { UpdateFeeStructureSchema } from '@/lib/validations/accounting';
import { requireTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await assertLegacyWritable(db, user.schoolId);

  await authorize(user, 'finance.fees.manage');

  const existing = await db.feeStructure.findUnique({ where: { id: ctx.params.id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Fee structure');

  const parsed = await parseBody(req, UpdateFeeStructureSchema);
  if ('error' in parsed) return parsed.error;
  const { levelId, termId, label, currency, amount } = parsed.data;

  if (termId) await requireTerm(user.schoolId, termId, db);
  if (levelId && !await db.level.findFirst({ where: { id: levelId, schoolId: user.schoolId } })) {
    return apiError('Level not found', 404);
  }

  const feeStructure = await db.$tx(async (tx) => {
    const fs = await tx.feeStructure.update({
      where: { id: existing.id },
      data: {
        ...(levelId  !== undefined ? { levelId }  : {}),
        ...(termId   !== undefined ? { termId }   : {}),
        ...(label    !== undefined ? { label }    : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(amount   !== undefined ? { amount }   : {}),
      },
      include: { level: { select: { name: true } }, term: { select: { name: true } } },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_FEE_STRUCTURE',
        entityType: 'FeeStructure',
        entityId:   fs.id,
        detail:     `${fs.label} — ${fs.currency} ${fs.amount} (${fs.level?.name ?? 'All levels'}, ${fs.term.name})`,
      },
      tx,
    );
    return fs;
  });

  return apiSuccess({ feeStructure });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/accounting/fee-structures/[id]', _PATCH as unknown as H);
