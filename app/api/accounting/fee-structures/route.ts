import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canBulkApplyFees } from '@/lib/permissions';
import { CreateFeeStructureSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canBulkApplyFees(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateFeeStructureSchema);
  if ('error' in parsed) return parsed.error;
  const { grade, term, label, currency, amount } = parsed.data;

  const feeStructure = await prisma.$transaction(async (tx) => {
    const fs = await tx.feeStructure.create({
      data: { schoolId: user.schoolId, grade, term, label, currency, amount },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_FEE_STRUCTURE',
        entityType: 'FeeStructure',
        entityId:   fs.id,
        detail:     `${label} — ${currency} ${amount} (${grade}, ${term})`,
      },
      tx,
    );
    return fs;
  });

  return apiSuccess({ feeStructure }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/fee-structures', _POST as H);
