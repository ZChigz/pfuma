import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { getDaysOverdue } from '@/lib/utils';
import { PRIMARY_GUARDIAN_INCLUDE } from '@/lib/students/guardians';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

// Students are admitted through POST /api/admin/students, which applies the
// admission rules; this route only lists balances.
async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const levelId = searchParams.get('levelId') || undefined;
  const statusFilter = searchParams.get('status') || undefined;
  const q = searchParams.get('q') || undefined;

  const rows = await prisma.student.findMany({
    where: {
      schoolId: user.schoolId,
      ...(includeInactive ? {} : { status: 'ACTIVE' }),
      ...(levelId ? { currentClass: { levelId } } : {}),
      ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { admissionNumber: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    include: {
      currentClass: { select: { name: true, level: { select: { name: true } } } },
      guardians: PRIMARY_GUARDIAN_INCLUDE,
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
    const { charges: _charges, payments: _payments, guardians, currentClass, ...rest } = s;
    return {
      ...rest,
      levelName: currentClass?.level.name ?? null,
      className: currentClass?.name ?? null,
      guardianName: guardians[0]?.guardian.fullName ?? null,
      guardianPhone: guardians[0]?.guardian.phone ?? null,
      balanceUSD,
      balanceZiG,
      overdueDays,
    };
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

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/accounting/students', _GET as H);
