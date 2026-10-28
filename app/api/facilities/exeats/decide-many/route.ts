// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { decideMany } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/decide-many', ['facilities.exeats.request', 'facilities.exeats.approve'], async ({ user, req }) => decideMany(user, await body(req)));
