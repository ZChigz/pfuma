import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { z } from 'zod';
import type { SessionUser } from '@/types';

const SetExchangeRateSchema = z.object({
  usdToZig: z.number({ invalid_type_error: 'Please enter a rate' }).positive('Rate must be positive'),
  note: z.string().optional(),
});

const ALLOWED_ROLES = ['BURSAR', 'HEAD', 'DIRECTOR'] as const;

async function _GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const rate = await prisma.exchangeRate.findFirst({
    where: { schoolId: user.schoolId },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { fullName: true } } },
  });

  if (!rate) {
    return apiSuccess({ rate: null });
  }

  return apiSuccess({ rate: { ...rate, usdToZig: rate.usdToZig.toNumber() } });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  if (!ALLOWED_ROLES.includes(user.role as typeof ALLOWED_ROLES[number])) {
    return new Response(
      JSON.stringify({ success: false, message: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const parsed = await parseBody(req, SetExchangeRateSchema);
  if ('error' in parsed) return parsed.error;

  const rate = await prisma.$transaction(async (tx) => {
    const r = await tx.exchangeRate.create({
      data: {
        schoolId: user.schoolId,
        usdToZig: parsed.data.usdToZig,
        setBy:    user.id,
        note:     parsed.data.note || null,
      },
      include: { user: { select: { fullName: true } } },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_ASSET',
        entityType: 'ExchangeRate',
        entityId:   r.id,
        detail:     `1 USD = ZiG ${parsed.data.usdToZig}${parsed.data.note ? ` — ${parsed.data.note}` : ''}`,
      },
      tx,
    );
    return r;
  });

  return apiSuccess({ rate: { ...rate, usdToZig: rate.usdToZig.toNumber() } }, 201);
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/accounting/exchange-rate',  _GET  as H);
export const POST = withApi('POST /api/accounting/exchange-rate', _POST as H);
