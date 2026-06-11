import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canBulkApplyFees } from '@/lib/permissions';
import { BulkApplyFeesSchema } from '@/lib/validations/admin';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canBulkApplyFees(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, BulkApplyFeesSchema);
  if ('error' in parsed) return parsed.error;
  const { scope, classId, grade, feeStructureId, term } = parsed.data;

  const feeStructure = await prisma.feeStructure.findUnique({ where: { id: feeStructureId } });
  if (!feeStructure || feeStructure.schoolId !== user.schoolId) return apiError('Fee structure not found', 404);

  if (scope === 'class') {
    const schoolClass = await prisma.schoolClass.findUnique({ where: { id: classId } });
    if (!schoolClass || schoolClass.schoolId !== user.schoolId) return apiError('Class not found', 404);
  }

  const students = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      active: true,
      ...(scope === 'class' ? { classId } : { grade }),
    },
    select: { id: true },
  });

  const existingCharges = await prisma.charge.findMany({
    where: {
      studentId: { in: students.map((s) => s.id) },
      term,
      label: feeStructure.label,
    },
    select: { studentId: true },
  });
  const alreadyCharged = new Set(existingCharges.map((c) => c.studentId));
  const toApply = students.filter((s) => !alreadyCharged.has(s.id));

  const applied = await prisma.$transaction(async (tx) => {
    for (const s of toApply) {
      await tx.charge.create({
        data: {
          schoolId: user.schoolId,
          studentId: s.id,
          term,
          label: feeStructure.label,
          currency: feeStructure.currency,
          amount: feeStructure.amount,
        },
      });
    }
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'BULK_APPLY_FEES',
        entityType: 'FeeStructure',
        entityId:   feeStructure.id,
        detail:     `Applied "${feeStructure.label}" (${feeStructure.currency} ${feeStructure.amount}) to ${toApply.length} student(s) for ${term}`,
      },
      tx,
    );
    return toApply.length;
  });

  return apiSuccess({ applied, skipped: alreadyCharged.size });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/fees/bulk-apply', _POST as H);
