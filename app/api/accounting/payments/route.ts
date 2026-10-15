import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, apiError, withApi } from '@/lib/api';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { rateFor } from '@/lib/exchange-rate';
import { logAudit } from '@/lib/audit';
import { canRecordPayment } from '@/lib/permissions';
import { CreatePaymentSchema } from '@/lib/validations/accounting';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const { searchParams } = req.nextUrl;
  const status    = searchParams.get('status')    || undefined;
  const method    = searchParams.get('method')    || undefined;
  const currency  = searchParams.get('currency')  || undefined;
  const studentId = searchParams.get('studentId') || undefined;

  const payments = await db.payment.findMany({
    where: {
      schoolId: user.schoolId,
      ...(status    ? { status:    status    as never } : {}),
      ...(method    ? { method:    method    as never } : {}),
      ...(currency  ? { currency:  currency  as never } : {}),
      ...(studentId ? { studentId }                     : {}),
    },
    include: {
      student:  { select: { fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } },
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
  const db = getScopedDb(user.schoolId, user.id);

  try { await canRecordPayment(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreatePaymentSchema);
  if ('error' in parsed) return parsed.error;

  const [student, school] = await Promise.all([
    db.student.findUnique({
      where: { id: parsed.data.studentId },
      select: {
        id: true, schoolId: true, fullName: true,
        currentClass: { select: { name: true } },
        guardians: PRIMARY_GUARDIAN_INCLUDE,
      },
    }),
    db.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    }),
  ]);
  if (!student || student.schoolId !== user.schoolId) return apiNotFound('Student');
  if (parsed.data.popKey && !proofKeyBelongsTo(parsed.data.popKey, user.schoolId)) {
    return apiError('That proof of payment was not uploaded for this school', 422);
  }

  const isCash = parsed.data.method === 'CASH';
  const now    = new Date();

  // A ZiG payment uses the rate in force on the payment date (latest effectiveFrom on or
  // before it) and links to that exact row. The browser may only confirm it.
  let rateRow: Awaited<ReturnType<typeof rateFor>> = null;
  if (parsed.data.paidInZig) {
    rateRow = await rateFor(db, now);
    if (!rateRow) return apiError('No exchange rate is in force. Set one under Settings first.', 409);
    const rate = rateRow.usdToZig.toNumber();
    if (parsed.data.exchangeRateUsed && Math.abs(parsed.data.exchangeRateUsed - rate) > 0.0001) {
      return apiError(`The exchange rate in force is ZiG ${rate}, not ${parsed.data.exchangeRateUsed}. Reload the page and try again.`, 409);
    }
    if (parsed.data.zigAmountPaid && Math.abs(parsed.data.amount - parsed.data.zigAmountPaid / rate) > 0.02) {
      return apiError('Amount does not match ZiG conversion', 422);
    }
  }

  const payment = await db.$tx(async (tx) => {
    const p = await tx.payment.create({
      data: {
        schoolId:        user.schoolId,
        studentId:       parsed.data.studentId,
        currency:        parsed.data.currency,
        amount:          parsed.data.amount,
        method:          parsed.data.method,
        reference:       parsed.data.reference  || null,
        feeLabel:        parsed.data.feeLabel,
        popKey:          parsed.data.popKey     || null,
        status:          isCash ? 'VERIFIED' : 'PENDING',
        recordedBy:      user.id,
        verifiedBy:      isCash ? user.id : null,
        verifiedAt:      isCash ? now    : null,
        paidInZig:        parsed.data.paidInZig,
        zigAmountPaid:    parsed.data.zigAmountPaid    ?? null,
        exchangeRateUsed: rateRow ? rateRow.usdToZig.toNumber() : null,
        exchangeRateId:   rateRow?.id ?? null,
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
      studentGrade:       student.currentClass?.name ?? '',
      studentParentPhone: student.guardians[0]?.guardian.phone ?? '',
    },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/payments',  _GET  as H);
export const POST = withApi('POST /api/accounting/payments', _POST as H);
