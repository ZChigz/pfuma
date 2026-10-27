import type { NextRequest } from 'next/server';
import { libraryMoved, LIBRARY_MOVED_MESSAGE } from '@/lib/library';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';
import { authorize } from '@/lib/access';
import { getOpenTerm } from '@/lib/academic/terms';
import { raiseCharge } from '@/lib/finance/external';
import { parseBody, apiSuccess, apiError, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { z } from 'zod';
import type { SessionUser } from '@/types';

// BORROWED is not settable by hand: a copy becomes BORROWED by being checked out.
const UpdateCopySchema = z.object({
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'DAMAGED']).optional(),
  status:    z.enum(['AVAILABLE', 'LOST', 'DAMAGED', 'WITHDRAWN']).optional(),
  // Used when a student loses the copy and the book has no replacement cost yet.
  replacementCost: z.number().positive().optional(),
});

async function _PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  if (await libraryMoved(db, user.schoolId)) return apiError(LIBRARY_MOVED_MESSAGE, 409);

  await authorize(user, 'facilities.library.manage');

  const existing = await db.bookCopy.findFirst({
    where:   { id: params.id, schoolId: user.schoolId },
    include: {
      book: true,
      borrowings: {
        where: { returnDate: null },
        include: { member: { include: { student: { select: { id: true, fullName: true } } } } },
      },
    },
  });
  if (!existing) return apiNotFound('Book copy');

  const parsed = await parseBody(req, UpdateCopySchema);
  if ('error' in parsed) return parsed.error;
  const { status, condition } = parsed.data;

  const open = existing.borrowings[0] ?? null;
  if (open && (status === 'AVAILABLE' || status === 'DAMAGED' || status === 'WITHDRAWN')) {
    return apiError('This copy is on loan. Return it first, or mark it lost.', 409);
  }
  if (!open && existing.status === 'BORROWED' && status === 'AVAILABLE') {
    // a copy stuck as borrowed without a loan can be put back
  }

  // Losing a copy a student has borrowed charges the student its replacement cost.
  const studentBorrower = status === 'LOST' && open?.member.memberType === 'STUDENT' ? open.member.student : null;
  let charge: { amount: number; currency: 'USD' | 'ZIG'; termId: string } | null = null;
  if (studentBorrower) {
    const cost = existing.book.replacementCost?.toNumber() ?? parsed.data.replacementCost;
    if (!cost) {
      return apiError(`${studentBorrower.fullName} borrowed this copy, so they are charged its replacement cost. Enter the replacement cost for "${existing.book.title}".`, 422);
    }
    const term = await getOpenTerm(user.schoolId, db);
    if (!term) return apiError('No term is open, so the replacement charge cannot be raised. Open a term first.', 409);
    charge = { amount: cost, currency: existing.book.replacementCurrency, termId: term.id };
  }

  const copy = await db.$tx(async (tx) => {
    const c = await tx.bookCopy.update({
      where: { id: params.id },
      data: {
        ...(condition !== undefined ? { condition } : {}),
        ...(status    !== undefined ? { status    } : {}),
      },
    });

    if (status === 'LOST' && open) {
      // The loan ends: the copy is gone.
      await tx.borrowing.update({
        where: { id: open.id },
        data:  { returnDate: new Date(), conditionOnReturn: 'DAMAGED' },
      });
    }

    if (charge && studentBorrower) {
      if (existing.book.replacementCost == null) {
        await tx.book.update({ where: { id: existing.bookId }, data: { replacementCost: charge.amount } });
      }
      // On the student's account in Finance (General fund) for a school that runs its money there; else the first accounting tables.
      const created = await raiseCharge(tx, {
        schoolId: user.schoolId, actorId: user.id, studentId: studentBorrower.id, termId: charge.termId,
        description: `Lost library book: ${existing.book.title} (${existing.accessionNumber})`, currency: charge.currency, amount: charge.amount, source: 'LIBRARY',
      });
      await logAudit(
        {
          schoolId: user.schoolId, actorId: user.id, action: 'APPLY_CHARGE', entityType: created.legacy ? 'Charge' : 'FinCharge', entityId: created.id,
          detail: `Replacement cost of lost book ${existing.book.title} — ${charge.currency} ${charge.amount} (${studentBorrower.fullName})`,
        },
        tx,
      );
    }

    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_BOOK_COPY', entityType: 'BookCopy', entityId: params.id,
        detail: `${existing.book.title} (${existing.accessionNumber}): ${[
          status !== undefined && status !== existing.status ? `${existing.status} → ${status}` : null,
          condition !== undefined && condition !== existing.condition ? `condition ${existing.condition} → ${condition}` : null,
        ].filter(Boolean).join('; ') || 'no change'}${charge ? '; replacement charge raised' : ''}`,
      },
      tx,
    );
    return c;
  });

  return apiSuccess({ copy, charged: charge ? { amount: charge.amount, currency: charge.currency } : null });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const PATCH = withApi('PATCH /api/library/copies/[id]', _PATCH as H);
