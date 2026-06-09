import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canApplyCharge } from '@/lib/permissions';
import { CreateChargeSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const parsed = await parseBody(req, CreateChargeSchema);
  if ('error' in parsed) return parsed.error;

  try {
    await canApplyCharge(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  // Verify the student belongs to this school (never trust body schoolId)
  const student = await prisma.student.findUnique({
    where: { id: params.id },
    select: { id: true, schoolId: true },
  });
  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');

  const charge = await prisma.$transaction(async (tx) => {
    const newCharge = await tx.charge.create({
      data: {
        schoolId: user.schoolId,
        studentId: params.id,
        label: parsed.data.label,
        currency: parsed.data.currency,
        amount: parsed.data.amount,
        term: parsed.data.term,
      },
    });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'APPLY_CHARGE',
        entityType: 'Charge',
        entityId: newCharge.id,
        detail: `${parsed.data.label} — ${parsed.data.currency} ${parsed.data.amount}`,
      },
      tx,
    );
    return newCharge;
  });

  return apiSuccess({ charge }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/students/[id]/charges', _POST as H);
