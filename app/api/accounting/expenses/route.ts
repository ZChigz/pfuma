import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canRecordExpense } from '@/lib/permissions';
import { CreateExpenseSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const currency = searchParams.get('currency') || undefined;
  const category = searchParams.get('category') || undefined;
  const from     = searchParams.get('from')     || undefined;
  const to       = searchParams.get('to')       || undefined;

  const expenses = await prisma.expense.findMany({
    where: {
      schoolId: user.schoolId,
      ...(currency ? { currency: currency as never } : {}),
      ...(category ? { category }                    : {}),
      ...(from || to
        ? {
            spentOn: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to   ? { lte: new Date(to)   } : {}),
            },
          }
        : {}),
    },
    include: {
      recorder: { select: { fullName: true } },
      voider:   { select: { fullName: true } },
    },
    orderBy: { spentOn: 'desc' },
  });

  return apiSuccess({ expenses });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canRecordExpense(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const parsed = await parseBody(req, CreateExpenseSchema);
  if ('error' in parsed) return parsed.error;

  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: {
        schoolId:   user.schoolId,
        category:   parsed.data.category,
        currency:   parsed.data.currency,
        amount:     parsed.data.amount,
        spentOn:    new Date(parsed.data.spentOn),
        note:       parsed.data.note || null,
        recordedBy: user.id,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'RECORD_EXPENSE',
        entityType: 'Expense',
        entityId:   e.id,
        detail:     `${parsed.data.category} — ${parsed.data.currency} ${parsed.data.amount}`,
      },
      tx,
    );
    return e;
  });

  return apiSuccess({ expense: { ...expense, amount: expense.amount.toNumber() } }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/expenses',  _GET  as H);
export const POST = withApi('POST /api/accounting/expenses', _POST as H);
