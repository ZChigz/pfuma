import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { CreatePaymentSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const status    = searchParams.get('status')    || undefined;
  const method    = searchParams.get('method')    || undefined;
  const currency  = searchParams.get('currency')  || undefined;
  const studentId = searchParams.get('studentId') || undefined;

  const payments = await prisma.payment.findMany({
    where: {
      schoolId: user.schoolId,
      ...(status    ? { status:    status    as never } : {}),
      ...(method    ? { method:    method    as never } : {}),
      ...(currency  ? { currency:  currency  as never } : {}),
      ...(studentId ? { studentId }                     : {}),
    },
    include: {
      student:  { select: { fullName: true, grade: true } },
      recorder: { select: { fullName: true } },
      verifier: { select: { fullName: true } },
      voider:   { select: { fullName: true } },
    },
    orderBy: { recordedAt: 'desc' },
  });

  return apiSuccess({ payments });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const parsed = await parseBody(req, CreatePaymentSchema);
  if ('error' in parsed) return parsed.error;

  const [student, school] = await Promise.all([
    prisma.student.findUnique({
      where: { id: parsed.data.studentId },
      select: { id: true, schoolId: true, fullName: true, grade: true, parentPhone: true },
    }),
    prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    }),
  ]);
  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');

  const isCash = parsed.data.method === 'CASH';
  const now    = new Date();

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        schoolId:        user.schoolId,
        studentId:       parsed.data.studentId,
        currency:        parsed.data.currency,
        amount:          parsed.data.amount,
        method:          parsed.data.method,
        reference:       parsed.data.reference  || null,
        feeLabel:        parsed.data.feeLabel,
        popUrl:          parsed.data.popUrl     || null,
        status:          isCash ? 'VERIFIED' : 'PENDING',
        recordedBy:      user.id,
        verifiedBy:      isCash ? user.id : null,
        verifiedAt:      isCash ? now    : null,
        paidInZig:        parsed.data.paidInZig,
        zigAmountPaid:    parsed.data.zigAmountPaid    ?? null,
        exchangeRateUsed: parsed.data.exchangeRateUsed ?? null,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'RECORD_PAYMENT',
        entityType: 'Payment',
        entityId:   p.id,
        detail:     `${parsed.data.currency} ${parsed.data.amount} — ${parsed.data.method}`,
      },
      tx,
    );
    return p;
  });

  return apiSuccess(
    {
      payment: {
        ...payment,
        amount:           payment.amount.toNumber(),
        zigAmountPaid:    payment.zigAmountPaid?.toNumber()    ?? null,
        exchangeRateUsed: payment.exchangeRateUsed?.toNumber() ?? null,
      },
      schoolName:         school?.name          ?? '',
      studentFullName:    student.fullName,
      studentGrade:       student.grade,
      studentParentPhone: student.parentPhone,
    },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/payments',  _GET  as H);
export const POST = withApi('POST /api/accounting/payments', _POST as H);
