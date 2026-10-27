// Any signed-in member of staff reports a fault; the service checks they have a staff record.
import { apiSuccess, withApi } from '@/lib/api';
import { requireSignedIn } from '@/lib/access';
import { body } from '@/lib/finance/route';
import { reportFault } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = withApi('POST /api/facilities/assets/faults', async (req: Request) => {
  const user = await requireSignedIn();
  return apiSuccess(await reportFault(user, await body(req)), 201);
});
