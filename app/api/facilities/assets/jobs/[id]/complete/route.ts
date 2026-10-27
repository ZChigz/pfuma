// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded, body } from '@/lib/finance/route';
import { completeJob } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/assets/jobs/[id]/complete', ['facilities.assets.maintain'], async ({ user, params, req }) => completeJob(user, params.id!, await body(req)));
