import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiError, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { CheckoutSchema } from '@/lib/validations/library';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const overdue   = searchParams.get('overdue')   === 'true';
  const history   = searchParams.get('history')   === 'true';
  const memberId  = searchParams.get('memberId')  || undefined;
  const accession = searchParams.get('accession') || undefined;

  const now = new Date();

  const borrowings = await prisma.borrowing.findMany({
    where: {
      schoolId: user.schoolId,
      ...(history ? {} : { returnDate: null }),
      ...(overdue ? { returnDate: null, dueDate: { lt: now } } : {}),
      ...(memberId  ? { memberId }                                           : {}),
      ...(accession ? { copy: { accessionNumber: accession } }               : {}),
    },
    include: {
      member: { include: { user: { select: { fullName: true } } } },
      copy:   { include: { book: { select: { id: true, title: true } } } },
    },
    orderBy: { checkoutDate: 'desc' },
  });

  const enriched = borrowings.map((b) => ({
    ...b,
    fineAmount:  b.fineAmount.toNumber(),
    daysOverdue: b.returnDate ? 0 : Math.max(0, getDaysOverdue(b.dueDate)),
    checkoutDate: b.checkoutDate.toISOString(),
    dueDate:      b.dueDate.toISOString(),
    returnDate:   b.returnDate?.toISOString() ?? null,
    createdAt:    b.createdAt.toISOString(),
  }));

  return apiSuccess({ borrowings: enriched });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const parsed = await parseBody(req, CheckoutSchema);
  if ('error' in parsed) return parsed.error;

  const [copy, member] = await Promise.all([
    prisma.bookCopy.findFirst({
      where: { id: parsed.data.copyId, schoolId: user.schoolId },
    }),
    prisma.libraryMember.findFirst({
      where:   { id: parsed.data.memberId, schoolId: user.schoolId },
      include: { borrowings: { where: { returnDate: null } } },
    }),
  ]);

  if (!copy)   return apiNotFound('Book copy');
  if (!member) return apiNotFound('Library member');

  if (copy.status !== 'AVAILABLE') {
    return apiError('This copy is not available for checkout', 409);
  }
  if (member.borrowingSuspended) {
    return apiError("This member's borrowing privilege is suspended", 403);
  }
  if (member.borrowings.length >= 3) {
    return apiError('Member already has 3 active borrowings — the maximum allowed', 409);
  }

  const loanDays = parseInt(process.env.LOAN_PERIOD_DAYS || '14', 10);
  const dueDate  = parsed.data.dueDate
    ? new Date(parsed.data.dueDate)
    : new Date(Date.now() + loanDays * 86_400_000);

  const borrowing = await prisma.$transaction(async (tx) => {
    const borrow = await tx.borrowing.create({
      data: {
        schoolId:     user.schoolId,
        copyId:       parsed.data.copyId,
        memberId:     parsed.data.memberId,
        checkoutDate: new Date(),
        dueDate,
      },
      include: {
        member: { include: { user: { select: { fullName: true } } } },
        copy:   { include: { book: { select: { title: true } } } },
      },
    });
    await tx.bookCopy.update({
      where: { id: parsed.data.copyId },
      data:  { status: 'BORROWED' },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CHECKOUT_BOOK',
        entityType: 'Borrowing',
        entityId:   borrow.id,
        detail:     `${borrow.copy.book.title} → ${borrow.member.user.fullName}`,
      },
      tx,
    );
    return borrow;
  });

  return apiSuccess(
    { borrowing: { ...borrowing, fineAmount: borrowing.fineAmount.toNumber() } },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/library/borrowing',  _GET  as H);
export const POST = withApi('POST /api/library/borrowing', _POST as H);
