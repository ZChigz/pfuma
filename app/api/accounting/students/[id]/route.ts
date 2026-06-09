import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { UpdateStudentSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const student = await prisma.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    include: {
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

  const parsed = await parseBody(req, UpdateStudentSchema);
  if ('error' in parsed) return parsed.error;

  try {
    await canManageStudents(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const existing = await prisma.student.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { id: true },
  });
  if (!existing) return apiNotFound('Student');

  const student = await prisma.student.update({
    where: { id: params.id },
    data: parsed.data,
  });

  await logAudit({
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'UPDATE_STUDENT',
    entityType: 'Student',
    entityId: student.id,
  });

  return apiSuccess({ student });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/accounting/students/[id]',   _GET   as H);
export const PATCH = withApi('PATCH /api/accounting/students/[id]', _PATCH as H);
