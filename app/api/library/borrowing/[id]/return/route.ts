import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiError, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { ReturnSchema } from '@/lib/validations/library';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const existing = await prisma.borrowing.findFirst({
    where:   { id: params.id, schoolId: user.schoolId },
    include: {
      copy:   { include: { book: { select: { title: true } } } },
      member: { include: { user: { select: { fullName: true } } } },
    },
  });
  if (!existing)          return apiNotFound('Borrowing');
  if (existing.returnDate) return apiError('This book has already been returned', 409);

  const parsed = await parseBody(req, ReturnSchema);
  if ('error' in parsed) return parsed.error;

  const daysOverdue = Math.max(0, getDaysOverdue(existing.dueDate));
  const dailyRate   = parseFloat(process.env.DAILY_FINE_RATE || '0');
  const fineAmount  = daysOverdue * dailyRate;

  const newCopyStatus = parsed.data.conditionOnReturn === 'DAMAGED' ? 'AVAILABLE' : 'AVAILABLE';

  const borrowing = await prisma.$transaction(async (tx) => {
    const b = await tx.borrowing.update({
      where: { id: params.id },
      data: {
        returnDate:        new Date(),
        conditionOnReturn: parsed.data.conditionOnReturn,
        fineAmount,
        fineSettled:       parsed.data.fineSettled ?? false,
      },
    });
    await tx.bookCopy.update({
      where: { id: existing.copyId },
      data:  { status: newCopyStatus, condition: parsed.data.conditionOnReturn },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'RETURN_BOOK',
        entityType: 'Borrowing',
        entityId:   params.id,
        detail:     `${existing.copy.book.title} returned by ${existing.member.user.fullName}${fineAmount > 0 ? ` — fine $${fineAmount.toFixed(2)}` : ''}`,
      },
      tx,
    );
    return b;
  });

  return apiSuccess({ borrowing: { ...borrowing, fineAmount: borrowing.fineAmount.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/library/borrowing/[id]/return', _POST as H);
