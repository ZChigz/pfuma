import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';
import { canManageLibrary } from '@/lib/permissions';
import { parseBody, apiSuccess, apiError, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { CheckoutSchema } from '@/lib/validations/library';
import { getDaysOverdue } from '@/lib/utils';
import { checkoutBlock, memberName, libraryMoved, LIBRARY_MOVED_MESSAGE } from '@/lib/library';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const { searchParams } = req.nextUrl;
  const overdue   = searchParams.get('overdue')   === 'true';
  const history   = searchParams.get('history')   === 'true';
  const memberId  = searchParams.get('memberId')  || undefined;
  const accession = searchParams.get('accession') || undefined;

  const now = new Date();

  const borrowings = await db.borrowing.findMany({
    where: {
      schoolId: user.schoolId,
      ...(history ? {} : { returnDate: null }),
      ...(overdue ? { returnDate: null, dueDate: { lt: now } } : {}),
      ...(memberId  ? { memberId }                                           : {}),
      ...(accession ? { copy: { accessionNumber: accession } }               : {}),
    },
    include: {
      member: { include: { user: { select: { fullName: true } }, student: { select: { fullName: true, admissionNumber: true } } } },
      copy:   { include: { book: { select: { id: true, title: true } } } },
    },
    orderBy: { checkoutDate: 'desc' },
  });

  const enriched = borrowings.map((b) => ({
    ...b,
    memberName:  memberName(b.member),
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
  const db = getScopedDb(user.schoolId, user.id);
  if (await libraryMoved(db, user.schoolId)) return apiError(LIBRARY_MOVED_MESSAGE, 409);

  try { await canManageLibrary(user.role); } catch (res) { return res as Response; }

  const parsed = await parseBody(req, CheckoutSchema);
  if ('error' in parsed) return parsed.error;

  const [copy, member] = await Promise.all([
    db.bookCopy.findFirst({
      where: { id: parsed.data.copyId, schoolId: user.schoolId },
    }),
    db.libraryMember.findFirst({
      where:   { id: parsed.data.memberId, schoolId: user.schoolId },
      include: { borrowings: { where: { returnDate: null } }, student: { select: { fullName: true, status: true } } },
    }),
  ]);

  if (!copy)   return apiNotFound('Book copy');
  if (!member) return apiNotFound('Library member');

  if (copy.status !== 'AVAILABLE') {
    return apiError('This copy is not available for checkout', 409);
  }
  // Overdue books, unpaid fines above the school's limit, and the loan limit for this kind of member.
  const [school, unsettled] = await Promise.all([
    db.school.findUnique({ where: { id: user.schoolId }, select: { libraryFineLimit: true, studentLoanLimit: true, staffLoanLimit: true } }),
    db.borrowing.aggregate({ where: { memberId: member.id, returnDate: { not: null }, fineSettled: false }, _sum: { fineAmount: true } }),
  ]);
  const block = checkoutBlock({
    memberType: member.memberType,
    suspended: member.borrowingSuspended,
    suspensionReason: member.suspensionReason,
    openBorrowings: member.borrowings,
    unpaidFines: unsettled._sum.fineAmount?.toNumber() ?? 0,
    settings: {
      libraryFineLimit: school?.libraryFineLimit.toNumber() ?? 5,
      studentLoanLimit: school?.studentLoanLimit ?? 2,
      staffLoanLimit: school?.staffLoanLimit ?? 5,
    },
  });
  if (block) return apiError(block.message, block.status);
  if (member.student && member.student.status !== 'ACTIVE') {
    return apiError(`${member.student.fullName} is no longer an active student and cannot borrow`, 403);
  }

  const loanDays = parseInt(process.env.LOAN_PERIOD_DAYS || '14', 10);
  const dueDate  = parsed.data.dueDate
    ? new Date(parsed.data.dueDate)
    : new Date(Date.now() + loanDays * 86_400_000);

  const borrowing = await db.$tx(async (tx) => {
    const borrow = await tx.borrowing.create({
      data: {
        schoolId:     user.schoolId,
        copyId:       parsed.data.copyId,
        memberId:     parsed.data.memberId,
        checkoutDate: new Date(),
        dueDate,
      },
      include: {
        member: { include: { user: { select: { fullName: true } }, student: { select: { fullName: true, admissionNumber: true } } } },
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
        detail:     `${borrow.copy.book.title} → ${memberName(borrow.member)}`,
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
