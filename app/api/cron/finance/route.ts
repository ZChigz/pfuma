import { timingSafeEqual } from 'node:crypto';
import { apiError, apiSuccess, withApi } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { getScopedDb } from '@/lib/scoped-db';
import { runPlanSchedule } from '@/lib/finance/plans';

export const runtime = 'nodejs';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Once a day: payment plans are brought up to date, guardians are reminded three days before an instalment, and the bursar hears about missed ones.
async function _GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return apiError('Unauthorized', 401);
  const schools = await prisma.paymentPlan.findMany({ where: { status: 'ACTIVE' }, distinct: ['schoolId'], select: { schoolId: true } });
  const out: Record<string, unknown> = {};
  for (const s of schools) {
    try { out[s.schoolId] = await getScopedDb(s.schoolId).$tx((tx) => runPlanSchedule(tx, s.schoolId)); } catch (e) { out[s.schoolId] = { error: (e as Error).message }; }
  }
  return apiSuccess({ schools: schools.length, results: out });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/cron/finance', _GET as H);
