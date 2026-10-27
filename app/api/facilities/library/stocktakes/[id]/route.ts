// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { stocktakeResult } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/stocktakes/[id]', ['facilities.library.manage'], async ({ user, params }) => stocktakeResult(user, params.id!));
