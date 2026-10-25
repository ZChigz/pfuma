// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { setSuspended } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/members/suspend', ['facilities.library.manage'], async ({ user, req }) => setSuspended(user, await body(req)));
