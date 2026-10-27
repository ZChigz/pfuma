import { timingSafeEqual } from 'node:crypto';
import { apiError, apiSuccess, withApi } from '@/lib/api';
import { runFacilitiesSchedule } from '@/lib/facilities/schedule';

export const runtime = 'nodejs';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Once a day, in the evening in Harare (vercel.json): see lib/facilities/schedule.ts.
async function _GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return apiError('Unauthorized', 401);
  return apiSuccess(await runFacilitiesSchedule());
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/cron/facilities', _GET as H);
