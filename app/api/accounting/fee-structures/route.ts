import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { apiError, apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canBulkApplyFees } from '@/lib/permissions';
import { CreateFeeStructureSchema } from '@/lib/validations/accounting';
import { requireTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await assertLegacyWritable(db, user.schoolId);

  try { await canBulkApplyFees(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateFeeStructureSchema);
  if ('error' in parsed) return parsed.error;
  const { levelId, termId, label, currency, amount } = parsed.data;

  const term = await requireTerm(user.schoolId, termId, db);
  const level = levelId ? await db.level.findFirst({ where: { id: levelId, schoolId: user.schoolId } }) : null;
  if (levelId && !level) return apiError('Level not found', 404);

  const feeStructure = await db.$tx(async (tx) => {
    const fs = await tx.feeStructure.create({
      data: { schoolId: user.schoolId, levelId, termId, label, currency, amount },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_FEE_STRUCTURE',
        entityType: 'FeeStructure',
        entityId:   fs.id,
        detail:     `${label} — ${currency} ${amount} (${level?.name ?? 'All levels'}, ${term.name})`,
      },
      tx,
    );
    return fs;
  });

  return apiSuccess({ feeStructure }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/fee-structures', _POST as H);
