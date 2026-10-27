// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { listStocktakes, startStocktake } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/stocktakes', ['facilities.library.manage'], async ({ user }) => listStocktakes(user));
export const POST = guarded('POST /api/facilities/library/stocktakes', ['facilities.library.manage'], async ({ user, req }) => startStocktake(user, await body(req)), 201);
