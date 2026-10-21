// Public: a guardian with a valid portal link (and, when the link has one, the PIN cookie for this device) starts an online payment.
import { cookies } from 'next/headers';
import { z } from 'zod';
import { apiError, apiSuccess, parseBody, withApi } from '@/lib/api';
import { lookupPortalToken, pinCookieName, pinCookieValid } from '@/lib/portal';
import { startPaynow, StartSchema } from '@/lib/finance/paynow';

export const runtime = 'nodejs';

const Schema = z.object({ token: z.string().min(1).max(200) }).and(StartSchema);

export const POST = withApi('POST /api/portal/paynow/start', async (req: Request) => {
  const parsed = await parseBody(req, Schema);
  if ('error' in parsed) return parsed.error;
  const found = await lookupPortalToken(parsed.data.token);
  if (found.status !== 'ok') return apiError('This link is not valid', 404);
  if (!pinCookieValid(found.student, cookies().get(pinCookieName(found.student.portalTokenHash))?.value)) return apiError('Enter your PIN first', 403);
  const origin = new URL(req.url).origin;
  return apiSuccess(await startPaynow(found.student.schoolId, found.student.id, parsed.data, origin), 201);
});
