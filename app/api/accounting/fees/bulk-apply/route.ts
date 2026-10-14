import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, parseBody, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canBulkApplyFees } from '@/lib/permissions';
import { BulkApplyFeesSchema } from '@/lib/validations/admin';
import { requireTerm } from '@/lib/academic/terms';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

// Charges every student ENROLLED (Enrollment, status ACTIVE) in the class or
// level for the chosen term — not the student's current class.
async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canBulkApplyFees(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, BulkApplyFeesSchema);
  if ('error' in parsed) return parsed.error;
  const { scope, classId, levelId, feeStructureId, termId } = parsed.data;

  const term = await requireTerm(user.schoolId, termId);
  const feeStructure = await prisma.feeStructure.findFirst({ where: { id: feeStructureId, schoolId: user.schoolId } });
  if (!feeStructure) return apiError('Fee structure not found', 404);

  let targetName: string;
  if (scope === 'class') {
    const schoolClass = await prisma.schoolClass.findFirst({ where: { id: classId, schoolId: user.schoolId } });
    if (!schoolClass) return apiError('Class not found', 404);
    if (feeStructure.levelId && feeStructure.levelId !== schoolClass.levelId) {
      return apiError(`This fee structure is for a different level than ${schoolClass.name}`, 422);
    }
    targetName = schoolClass.name;
  } else {
    const level = await prisma.level.findFirst({ where: { id: levelId, schoolId: user.schoolId } });
    if (!level) return apiError('Level not found', 404);
    if (feeStructure.levelId && feeStructure.levelId !== level.id) {
      return apiError(`This fee structure is not for ${level.name}`, 422);
    }
    targetName = level.name;
  }

  const enrolled = await prisma.enrollment.findMany({
    where: {
      schoolId: user.schoolId,
      termId: term.id,
      status: 'ACTIVE',
      ...(scope === 'class' ? { classId } : { class: { levelId } }),
    },
    select: { studentId: true },
  });
  const studentIds = enrolled.map((e) => e.studentId);

  const existingCharges = await prisma.charge.findMany({
    where: { studentId: { in: studentIds }, termId: term.id, label: feeStructure.label },
    select: { studentId: true },
  });
  const alreadyCharged = new Set(existingCharges.map((c) => c.studentId));
  const toApply = studentIds.filter((id) => !alreadyCharged.has(id));

  const applied = await prisma.$transaction(async (tx) => {
    await tx.charge.createMany({
      data: toApply.map((studentId) => ({
        schoolId: user.schoolId,
        studentId,
        termId: term.id,
        label: feeStructure.label,
        currency: feeStructure.currency,
        amount: feeStructure.amount,
      })),
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'BULK_APPLY_FEES',
        entityType: 'FeeStructure',
        entityId:   feeStructure.id,
        detail:     `Applied "${feeStructure.label}" (${feeStructure.currency} ${feeStructure.amount}) to ${toApply.length} student(s) in ${targetName} for ${term.name}`,
      },
      tx,
    );
    return toApply.length;
  });

  return apiSuccess({ applied, skipped: alreadyCharged.size, termName: term.name });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/fees/bulk-apply', _POST as H);
