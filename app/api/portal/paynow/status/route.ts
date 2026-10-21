// Public: the portal asks whether a payment it started has gone through (the reference is unguessable and shows nothing but the state).
import { apiSuccess, withApi, ServiceError } from '@/lib/api';
import { pollPaynow } from '@/lib/finance/paynow';

export const runtime = 'nodejs';

export const GET = withApi('GET /api/portal/paynow/status', async (req: Request) => {
  const ref = new URL(req.url).searchParams.get('ref') ?? '';
  if (!/^PFM-[0-9A-F]{12}$/.test(ref)) throw new ServiceError('Unknown reference', 404);
  return apiSuccess(await pollPaynow(ref));
});
