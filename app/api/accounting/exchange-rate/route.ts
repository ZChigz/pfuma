import { type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';
import { parseBody, apiSuccess, apiUnauthorized, withApi, apiError } from '@/lib/api';
import { z } from 'zod';
import { rateFor } from '@/lib/exchange-rate';
import type { SessionUser } from '@/types';

const SetExchangeRateSchema = z.object({
  usdToZig: z.number({ error: 'Please enter a rate' }).positive('Rate must be positive'),
  note: z.string().optional(),
  // When the rate starts to apply (default: now). Rows are never edited: a correction is a new row.
  effectiveFrom: z.coerce.date().optional(),
  source: z.enum(['RBZ', 'SCHOOL', 'OTHER']).optional().default('SCHOOL'),
});

const ALLOWED_ROLES = ['BURSAR', 'HEAD', 'DIRECTOR'] as const;

async function _GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  // The rate in force now: latest effectiveFrom on or before now, not simply the newest row.
  const rate = await rateFor(db, new Date());

  if (!rate) {
    return apiSuccess({ rate: null });
  }

  return apiSuccess({ rate: { ...rate, usdToZig: rate.usdToZig.toNumber() } });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  if (!ALLOWED_ROLES.includes(user.role as typeof ALLOWED_ROLES[number])) {
    return new Response(
      JSON.stringify({ success: false, message: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const parsed = await parseBody(req, SetExchangeRateSchema);
  if ('error' in parsed) return parsed.error;
  if (parsed.data.effectiveFrom && parsed.data.effectiveFrom.getTime() > Date.now() + 60 * 864e5) {
    return apiError('A rate cannot start more than 60 days from now', 422);
  }

  const rate = await db.$tx(async (tx) => {
    const r = await tx.exchangeRate.create({
      data: {
        schoolId: user.schoolId,
        usdToZig: parsed.data.usdToZig,
        setBy:    user.id,
        note:     parsed.data.note || null,
        effectiveFrom: parsed.data.effectiveFrom ?? new Date(),
        source:   parsed.data.source,
      },
      include: { user: { select: { fullName: true } } },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'SET_EXCHANGE_RATE',
        entityType: 'ExchangeRate',
        entityId:   r.id,
        detail:     `1 USD = ZiG ${parsed.data.usdToZig} from ${(parsed.data.effectiveFrom ?? new Date()).toISOString()} (${parsed.data.source})${parsed.data.note ? ` — ${parsed.data.note}` : ''}`,
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
