// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { setCollector } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/[id]/collector', ['facilities.exeats.request', 'facilities.exeats.signout'], async ({ user, params, req }) => setCollector(user, params.id!, await body(req)));
