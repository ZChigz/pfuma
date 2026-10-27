// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { decideExeat } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/[id]/decide', ['facilities.exeats.request', 'facilities.exeats.approve'], async ({ user, params, req }) => decideExeat(user, params.id!, await body(req)));
