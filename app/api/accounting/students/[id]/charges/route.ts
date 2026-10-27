import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { CreateChargeSchema } from '@/lib/validations/accounting';
import { requireTerm } from '@/lib/academic/terms';
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

  const parsed = await parseBody(req, CreateChargeSchema);
  if ('error' in parsed) return parsed.error;

  await authorize(user, 'finance.charges.create');

  // Verify the student belongs to this school (never trust body schoolId)
  const student = await db.student.findUnique({
    where: { id: params.id },
    select: { id: true, schoolId: true },
  });
  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');
  const term = await requireTerm(user.schoolId, parsed.data.termId, db);

  const charge = await db.$tx(async (tx) => {
    const newCharge = await tx.charge.create({
      data: {
        schoolId: user.schoolId,
        studentId: params.id,
        label: parsed.data.label,
        currency: parsed.data.currency,
        amount: parsed.data.amount,
        termId: term.id,
      },
    });
    await logAudit(
      {
        schoolId: user.schoolId,
        actorId: user.id,
        action: 'APPLY_CHARGE',
        entityType: 'Charge',
        entityId: newCharge.id,
        detail: `${parsed.data.label} — ${parsed.data.currency} ${parsed.data.amount} (${term.name})`,
      },
      tx,
    );
    return newCharge;
  });

  return apiSuccess({ charge }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/accounting/students/[id]/charges', _POST as H);
