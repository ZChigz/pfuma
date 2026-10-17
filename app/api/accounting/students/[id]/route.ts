import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { UpdateStudentSchema } from '@/lib/validations/accounting';
import { normalizeName } from '@/lib/students/registration';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const student = await db.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    // Only what a fee statement needs. Medical, ID and portal-link details are never part of this answer.
    select: {
      id: true, admissionNumber: true, firstName: true, surname: true, fullName: true, status: true, currentClassId: true, admissionDate: true,
      charges: { orderBy: { issuedAt: 'desc' } },
      payments: { orderBy: { recordedAt: 'desc' } },
    },
  });
  if (!student) return apiNotFound('Student');

  const cUSD = student.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
  const cZiG = student.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
  const pUSD = student.payments.filter(p => p.currency === 'USD' && p.status === 'VERIFIED').reduce((n, p) => n + p.amount.toNumber(), 0);
  const pZiG = student.payments.filter(p => p.currency === 'ZIG' && p.status === 'VERIFIED').reduce((n, p) => n + p.amount.toNumber(), 0);

  return apiSuccess({
    student,
    balanceUSD: cUSD - pUSD,
    balanceZiG: cZiG - pZiG,
  });
}

async function _PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const parsed = await parseBody(req, UpdateStudentSchema);
  if ('error' in parsed) return parsed.error;

  try {
    await canManageStudents(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const existing = await db.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true, firstName: true, surname: true },
  });
  if (!existing) return apiNotFound('Student');

  const firstName = parsed.data.firstName ? normalizeName(parsed.data.firstName) : existing.firstName;
  const surname = parsed.data.surname ? normalizeName(parsed.data.surname) : existing.surname;

  const student = await db.$tx(async (tx) => {
    const s = await tx.student.update({
      where: { id: params.id },
      data: { ...parsed.data, firstName, surname, fullName: `${firstName} ${surname}`.trim() },
    });
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_STUDENT', entityType: 'Student', entityId: s.id, detail: s.fullName },
      tx,
    );
    return s;
  });

  return apiSuccess({ student });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/accounting/students/[id]',   _GET   as H);
export const PATCH = withApi('PATCH /api/accounting/students/[id]', _PATCH as H);
