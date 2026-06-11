import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiNotFound, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canBulkApplyFees } from '@/lib/permissions';
import { UpdateFeeStructureSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canBulkApplyFees(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const existing = await prisma.feeStructure.findUnique({ where: { id: ctx.params.id } });
  if (!existing || existing.schoolId !== user.schoolId) return apiNotFound('Fee structure');

  const parsed = await parseBody(req, UpdateFeeStructureSchema);
  if ('error' in parsed) return parsed.error;
  const { grade, term, label, currency, amount } = parsed.data;

  const feeStructure = await prisma.$transaction(async (tx) => {
    const fs = await tx.feeStructure.update({
      where: { id: existing.id },
      data: {
        ...(grade    !== undefined ? { grade }    : {}),
        ...(term     !== undefined ? { term }     : {}),
        ...(label    !== undefined ? { label }    : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(amount   !== undefined ? { amount }   : {}),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_FEE_STRUCTURE',
        entityType: 'FeeStructure',
        entityId:   fs.id,
        detail:     `${fs.label} — ${fs.currency} ${fs.amount} (${fs.grade}, ${fs.term})`,
      },
      tx,
    );
    return fs;
  });

  return apiSuccess({ feeStructure });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/accounting/fee-structures/[id]', _PATCH as H);
