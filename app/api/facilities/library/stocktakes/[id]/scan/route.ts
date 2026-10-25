// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { scanStocktake } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/stocktakes/[id]/scan', ['facilities.library.manage'], async ({ user, params, req }) => scanStocktake(user, params.id!, await body(req)));
