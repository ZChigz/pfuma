// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { bulkExeats } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/bulk', ['facilities.exeats.request'], async ({ user, req }) => bulkExeats(user, await body(req)));
