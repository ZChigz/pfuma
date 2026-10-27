import { auth } from '@/lib/auth';
import { assertLegacyWritable } from '@/lib/finance/legacy-guard';
import { getScopedDb } from '@/lib/scoped-db';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { authorize, authorizeAny, can, schoolWide } from '@/lib/access';
import { generateRequestNumber } from '@/lib/request-number';
import { REQUEST_INCLUDE, serializeExpenseRequest } from '@/lib/expense-requests';
import { CreateExpenseRequestSchema } from '@/lib/validations/accounting';
import type { SessionUser } from '@/types';
import type { NextRequest } from 'next/server';

const BURSAR_STATUSES = ['APPROVED', 'DISBURSED'];

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  const access = await authorizeAny(user, ['finance.requests.create', 'finance.requests.view', 'finance.requests.approve', 'finance.requests.disburse']);

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status') || undefined;
  const type   = searchParams.get('type')   || undefined;
  const from   = searchParams.get('from')   || undefined;
  const to     = searchParams.get('to')     || undefined;

  const where: Record<string, unknown> = {
    schoolId: user.schoolId,
    ...(type ? { type: type as never } : {}),
    ...(from || to
      ? {
          requestedAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        }
      : {}),
  };

  // Whoever may only raise requests sees their own; whoever pays them out sees the ones that are ready to pay; whoever approves sees all.
  if (!schoolWide(access, 'finance.requests.view') && !can(access, 'finance.requests.approve') && !can(access, 'finance.requests.disburse')) {
    where.requestedById = user.id;
    if (status) where.status = status as never;
  } else if (can(access, 'finance.requests.disburse') && !can(access, 'finance.requests.approve')) {
    where.status =
      status && BURSAR_STATUSES.includes(status)
        ? (status as never)
        : ({ in: BURSAR_STATUSES } as never);
  } else if (status) {
    where.status = status as never;
  }

  const requests = await db.expenseRequest.findMany({
    where: where as never,
    include: REQUEST_INCLUDE,
    orderBy: { requestedAt: 'desc' },
  });

  return apiSuccess({ requests: requests.map(serializeExpenseRequest) });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  await assertLegacyWritable(db, user.schoolId);

  await authorize(user, 'finance.requests.create');

  const parsed = await parseBody(req, CreateExpenseRequestSchema);
  if ('error' in parsed) return parsed.error;
  const { title, type, department, justification, currency, items } = parsed.data;

  const itemsWithTotals = items.map((item) => ({
    ...item,
    total: item.quantity * item.unitPrice,
  }));
  const estimatedTotal = itemsWithTotals.reduce((sum, item) => sum + item.total, 0);

  const request = await db.$tx(async (tx) => {
    const requestNumber = await generateRequestNumber(user.schoolId, tx);
    const r = await tx.expenseRequest.create({
      data: {
        schoolId:      user.schoolId,
        requestNumber,
        title,
        type,
        department,
        justification,
        currency,
        estimatedTotal,
        status:        'DRAFT',
        requestedById: user.id,
        items: {
          create: itemsWithTotals.map((item) => ({
            description: item.description,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            total:       item.total,
          })),
        },
      },
      include: REQUEST_INCLUDE,
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_EXPENSE_REQUEST',
        entityType: 'ExpenseRequest',
        entityId:   r.id,
        detail:     `${requestNumber} — ${title}`,
      },
      tx,
    );
    return r;
  });

  return apiSuccess({ request: serializeExpenseRequest(request) }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/requests',  _GET  as H);
export const POST = withApi('POST /api/accounting/requests', _POST as H);
