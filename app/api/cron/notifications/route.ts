import { timingSafeEqual } from 'node:crypto';
import { apiError, apiSuccess, withApi } from '@/lib/api';
import { runScheduledNotifications } from '@/lib/system/scheduled';

export const runtime = 'nodejs';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Called once a day by the scheduler (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
// Without CRON_SECRET set the route refuses everyone, so it can never be run by a stranger.
async function _GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization') ?? '';
  if (!secret || !same(given, `Bearer ${secret}`)) return apiError('Unauthorized', 401);
  return apiSuccess(await runScheduledNotifications());
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/cron/notifications', _GET as H);
