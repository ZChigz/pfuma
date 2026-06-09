import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { CreateStudentSchema } from '@/lib/validations/accounting';
import { getDaysOverdue } from '@/lib/utils';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const grade = searchParams.get('grade') || undefined;
  const statusFilter = searchParams.get('status') || undefined;
  const q = searchParams.get('q') || undefined;

  const rows = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      ...(includeInactive ? {} : { active: true }),
      ...(grade ? { grade } : {}),
      ...(q ? { fullName: { contains: q, mode: 'insensitive' } } : {}),
    },
    include: {
      charges: { select: { currency: true, amount: true, issuedAt: true } },
      payments: {
        where: { status: 'VERIFIED' },
        select: { currency: true, amount: true },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  const students = rows.map((s) => {
    const cUSD = s.charges.filter(c => c.currency === 'USD').reduce((n, c) => n + c.amount.toNumber(), 0);
    const cZiG = s.charges.filter(c => c.currency === 'ZIG').reduce((n, c) => n + c.amount.toNumber(), 0);
    const pUSD = s.payments.filter(p => p.currency === 'USD').reduce((n, p) => n + p.amount.toNumber(), 0);
    const pZiG = s.payments.filter(p => p.currency === 'ZIG').reduce((n, p) => n + p.amount.toNumber(), 0);
    const balanceUSD = cUSD - pUSD;
    const balanceZiG = cZiG - pZiG;
    const hasBalance = balanceUSD > 0 || balanceZiG > 0;
    const earliest =
      s.charges.length > 0
        ? s.charges.reduce((min, c) => (c.issuedAt < min ? c.issuedAt : min), s.charges[0].issuedAt)
        : null;
    const overdueDays = hasBalance && earliest ? getDaysOverdue(earliest) : 0;
    const { charges, payments, ...rest } = s;
    return { ...rest, balanceUSD, balanceZiG, overdueDays };
  });

  const filtered =
    statusFilter === 'cleared'
      ? students.filter(s => s.balanceUSD <= 0 && s.balanceZiG <= 0)
      : statusFilter === 'owing'
        ? students.filter(s => s.balanceUSD > 0 || s.balanceZiG > 0)
        : statusFilter === 'overdue30'
          ? students.filter(s => s.overdueDays >= 30)
          : students;

  return apiSuccess({ students: filtered });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const parsed = await parseBody(req, CreateStudentSchema);
  if ('error' in parsed) return parsed.error;

  try {
    await canManageStudents(user.role);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const student = await prisma.student.create({
    data: {
      ...parsed.data,
      schoolId: user.schoolId,
      portalToken: crypto.randomUUID(),
    },
  });

  await logAudit({
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'CREATE_STUDENT',
    entityType: 'Student',
    entityId: student.id,
  });

  return apiSuccess({ student }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/students',  _GET  as H);
export const POST = withApi('POST /api/accounting/students', _POST as H);
